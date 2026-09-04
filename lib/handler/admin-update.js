import crypto from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { verifyAdminToken, isMainAdmin } from "../_admin.js";
import { env } from "../_env.js";
import { requireSecurity } from "../_security.js";

const MAX_ZIP_BYTES = 25 * 1024 * 1024;
const MAX_FILE_BYTES = 12 * 1024 * 1024;
const MAX_FILES = 4000;
const PROTECTED_PREFIXES = [".git/", ".github/workflows/"];
const PROTECTED_EXACT = new Set([".gitignore", ".gitmodules"]);

function auth(req) {
  return verifyAdminToken(String(req.headers?.authorization || "").replace(/^Bearer\s+/i, ""));
}

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function normalizePath(name) {
  let p = String(name || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!p || p.endsWith("/")) return "";
  const parts = p.split("/").filter(Boolean);
  if (parts.some(part => part === "." || part === "..")) fail(`Path ZIP tidak aman: ${p}`);
  p = parts.join("/");
  return p;
}

function stripCommonRoot(entries) {
  if (!entries.length) return entries;
  const first = entries[0].path.split("/");
  if (first.length < 2) return entries;
  const root = first[0];
  if (!entries.every(e => e.path === root || e.path.startsWith(`${root}/`))) return entries;
  return entries.map(e => ({ ...e, path: e.path === root ? "" : e.path.slice(root.length + 1) })).filter(e => e.path);
}

function readU16(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}
function readU32(bytes, offset) {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

async function inflateDeflateRaw(data) {
  try {
    return new Uint8Array(inflateRawSync(Buffer.from(data)));
  } catch (error) {
    fail(`Gagal mengekstrak file ZIP: ${error?.message || "deflate tidak valid"}`);
  }
}

async function parseZip(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes.byteLength < 22) fail("File ZIP terlalu kecil atau tidak valid.");
  if (bytes.byteLength > MAX_ZIP_BYTES) fail(`Ukuran ZIP maksimal ${Math.round(MAX_ZIP_BYTES / 1024 / 1024)} MB.`);

  let eocd = -1;
  const start = Math.max(0, bytes.length - 65557);
  for (let i = bytes.length - 22; i >= start; i--) {
    if (readU32(bytes, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) fail("Struktur ZIP tidak valid: end of central directory tidak ditemukan.");

  const total = readU16(bytes, eocd + 10);
  const centralSize = readU32(bytes, eocd + 12);
  const centralOffset = readU32(bytes, eocd + 16);
  if (total > MAX_FILES) fail(`ZIP berisi terlalu banyak file. Maksimal ${MAX_FILES}.`);
  if (centralOffset + centralSize > bytes.length) fail("Struktur ZIP rusak: central directory berada di luar file.");

  const entries = [];
  let p = centralOffset;
  for (let i = 0; i < total; i++) {
    if (readU32(bytes, p) !== 0x02014b50) fail("Central directory ZIP tidak valid.");
    const flags = readU16(bytes, p + 8);
    const method = readU16(bytes, p + 10);
    const compressedSize = readU32(bytes, p + 20);
    const uncompressedSize = readU32(bytes, p + 24);
    const nameLen = readU16(bytes, p + 28);
    const extraLen = readU16(bytes, p + 30);
    const commentLen = readU16(bytes, p + 32);
    const localOffset = readU32(bytes, p + 42);
    const nameBytes = bytes.slice(p + 46, p + 46 + nameLen);
    const name = new TextDecoder("utf-8", { fatal: false }).decode(nameBytes);
    p += 46 + nameLen + extraLen + commentLen;

    const path = normalizePath(name);
    if (!path) continue;
    if (PROTECTED_EXACT.has(path) || PROTECTED_PREFIXES.some(prefix => path.startsWith(prefix))) {
      fail(`File ZIP tidak boleh menyentuh path sistem: ${path}`);
    }
    if (flags & 0x1) fail(`ZIP terenkripsi tidak didukung: ${path}`);
    if (uncompressedSize > MAX_FILE_BYTES) fail(`File terlalu besar: ${path}`);
    if (localOffset + 30 > bytes.length || readU32(bytes, localOffset) !== 0x04034b50) fail(`Local header tidak valid: ${path}`);
    const localNameLen = readU16(bytes, localOffset + 26);
    const localExtraLen = readU16(bytes, localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > bytes.length) fail(`Data ZIP terpotong: ${path}`);

    const compressed = bytes.slice(dataStart, dataEnd);
    let data;
    if (method === 0) data = compressed;
    else if (method === 8) data = await inflateDeflateRaw(compressed);
    else fail(`Metode kompresi ZIP tidak didukung (${method}): ${path}`);
    if (data.byteLength !== uncompressedSize) fail(`Ukuran hasil ekstraksi tidak cocok: ${path}`);
    entries.push({ path, data });
  }

  const normalized = stripCommonRoot(entries);
  const seen = new Set();
  for (const entry of normalized) {
    if (seen.has(entry.path)) fail(`Duplikat path di ZIP: ${entry.path}`);
    seen.add(entry.path);
  }
  if (!normalized.length) fail("ZIP tidak berisi file yang dapat diupdate.");
  return normalized;
}

function gitBlobSha(data) {
  const header = Buffer.from(`blob ${data.byteLength}\0`, "utf8");
  return crypto.createHash("sha1").update(Buffer.concat([header, Buffer.from(data)])).digest("hex");
}

function sha256Hex(data) {
  return crypto.createHash("sha256").update(Buffer.from(data)).digest("hex");
}

function githubConfig() {
  const token = env("GITHUB_TOKEN");
  const owner = env("GITHUB_OWNER");
  const repo = env("GITHUB_REPO");
  const branch = env("GITHUB_BRANCH") || "main";
  if (!token || !owner || !repo) fail("Konfigurasi GitHub belum lengkap: GITHUB_TOKEN, GITHUB_OWNER, dan GITHUB_REPO wajib tersedia.", 503);
  return { token, owner, repo, branch };
}

async function github(url, options = {}) {
  const cfg = githubConfig();
  const response = await fetch(`https://api.github.com${url}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${cfg.token}`,
      "X-GitHub-Api-Version": "2026-03-10",
      "User-Agent": "RYY-Digital-Store-Updater/1.0",
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!response.ok) fail(`GitHub API ${response.status}: ${typeof data === "string" ? data : data?.message || "Unknown error"}`, 502);
  return data;
}

async function getRepoSnapshot() {
  const cfg = githubConfig();
  const ref = await github(`/repos/${cfg.owner}/${cfg.repo}/git/ref/heads/${encodeURIComponent(cfg.branch)}`);
  const commitSha = ref.object?.sha;
  if (!commitSha) fail("Branch GitHub tidak memiliki commit yang valid.", 502);
  const commit = await github(`/repos/${cfg.owner}/${cfg.repo}/git/commits/${commitSha}`);
  const treeSha = commit.tree?.sha;
  if (!treeSha) fail("Git tree repository tidak tersedia.", 502);
  const tree = await github(`/repos/${cfg.owner}/${cfg.repo}/git/trees/${treeSha}?recursive=1`);
  if (tree.truncated) fail("Git tree terlalu besar untuk divalidasi dengan aman. Update dibatalkan.", 502);
  const files = new Map();
  for (const item of tree.tree || []) {
    if (item.type === "blob" && item.path) files.set(item.path, { sha: item.sha, size: item.size || 0 });
  }
  return { cfg, branch: cfg.branch, commitSha, treeSha, files };
}

async function buildPackage(buffer) {
  const entries = await parseZip(buffer);
  const map = new Map(entries.map(e => [e.path, e]));
  const manifest = entries.slice().sort((a, b) => a.path.localeCompare(b.path)).map(e => `${e.path}:${sha256Hex(e.data)}`).join("\n");
  return { entries, map, manifestHash: sha256Hex(Buffer.from(manifest, "utf8")) };
}

function makeDiff(pkg, repo) {
  const added = [], changed = [], unchanged = [];
  for (const entry of pkg.entries) {
    const old = repo.files.get(entry.path);
    const sha = gitBlobSha(entry.data);
    if (!old) added.push(entry.path);
    else if (old.sha !== sha) changed.push(entry.path);
    else unchanged.push(entry.path);
  }
  const deleted = [];
  for (const path of repo.files.keys()) {
    if (!pkg.map.has(path) && !PROTECTED_EXACT.has(path) && !PROTECTED_PREFIXES.some(prefix => path.startsWith(prefix))) deleted.push(path);
  }
  const sort = a => a.sort((x, y) => x.localeCompare(y));
  [added, changed, deleted, unchanged].forEach(sort);
  return { added, changed, deleted, unchanged, total: pkg.entries.length };
}

function encodeBase64(data) {
  return Buffer.from(data).toString("base64");
}

async function applyPackage(pkg, repo, admin) {
  const cfg = repo.cfg;
  const treeEntries = [];
  const changedSet = new Set();
  const diff = makeDiff(pkg, repo);
  diff.added.concat(diff.changed, diff.deleted).forEach(p => changedSet.add(p));

  // Create blobs first; index.html is intentionally processed last so it is the
  // final application file prepared before the single atomic Git commit.
  const normal = pkg.entries.filter(e => e.path !== "index.html").sort((a, b) => a.path.localeCompare(b.path));
  const indexEntry = pkg.map.get("index.html");
  for (const entry of normal) {
    if (!changedSet.has(entry.path)) continue;
    const blob = await github(`/repos/${cfg.owner}/${cfg.repo}/git/blobs`, {
      method: "POST",
      body: JSON.stringify({ content: encodeBase64(entry.data), encoding: "base64" })
    });
    treeEntries.push({ path: entry.path, mode: "100644", type: "blob", sha: blob.sha });
  }
  if (indexEntry && changedSet.has("index.html")) {
    const blob = await github(`/repos/${cfg.owner}/${cfg.repo}/git/blobs`, {
      method: "POST",
      body: JSON.stringify({ content: encodeBase64(indexEntry.data), encoding: "base64" })
    });
    treeEntries.push({ path: "index.html", mode: "100644", type: "blob", sha: blob.sha });
  }
  for (const path of diff.deleted) treeEntries.push({ path, mode: "100644", type: "blob", sha: null });

  if (!treeEntries.length) return { diff, committed: false, message: "Tidak ada perubahan yang perlu diterapkan." };

  const tree = await github(`/repos/${cfg.owner}/${cfg.repo}/git/trees`, {
    method: "POST",
    body: JSON.stringify({ base_tree: repo.treeSha, tree: treeEntries })
  });
  const commit = await github(`/repos/${cfg.owner}/${cfg.repo}/git/commits`, {
    method: "POST",
    body: JSON.stringify({
      message: `RYY STORE update by ${admin.username} — ${diff.changed.length} changed, ${diff.added.length} added, ${diff.deleted.length} deleted`,
      tree: tree.sha,
      parents: [repo.commitSha]
    })
  });
  await github(`/repos/${cfg.owner}/${cfg.repo}/git/refs/heads/${encodeURIComponent(cfg.branch)}`, {
    method: "PATCH",
    body: JSON.stringify({ sha: commit.sha, force: false })
  });

  return { diff, committed: true, commitSha: commit.sha, commitUrl: commit.html_url || `https://github.com/${cfg.owner}/${cfg.repo}/commit/${commit.sha}`, message: "Update berhasil diterapkan ke GitHub dalam satu commit atomic. index.html diproses terakhir." };
}

export default async function handler(req, res) {
  const securityError = await requireSecurity(req, res);
  if (securityError) return securityError;
  const admin = auth(req);
  if (!admin) return res.status(401).json({ success: false, message: "Sesi admin tidak valid." });
  if (!isMainAdmin(admin)) return res.status(403).json({ success: false, message: "Update script hanya tersedia untuk admin_utama." });
  if (req.method !== "POST") return res.status(405).json({ success: false, message: "Method tidak diizinkan." });

  try {
    const body = req.body;
    const file = body instanceof FormData ? body.get("file") : null;
    if (!file || typeof file.arrayBuffer !== "function") return res.status(400).json({ success: false, message: "File ZIP script belum dipilih." });
    if (file.size > MAX_ZIP_BYTES) return res.status(400).json({ success: false, message: `Ukuran ZIP maksimal ${Math.round(MAX_ZIP_BYTES / 1024 / 1024)} MB.` });

    const pkg = await buildPackage(await file.arrayBuffer());
    const repo = await getRepoSnapshot();
    const diff = makeDiff(pkg, repo);
    const action = String(body.get("action") || "preview");

    if (action === "preview") {
      return res.status(200).json({ success: true, action, manifestHash: pkg.manifestHash, branch: repo.branch, currentCommit: repo.commitSha, diff, note: "Preview hanya membaca repository. Belum ada file GitHub yang diubah." });
    }
    if (action !== "apply") return res.status(400).json({ success: false, message: "Action update tidak dikenal." });
    const expected = String(body.get("manifestHash") || "");
    if (!expected || expected !== pkg.manifestHash) return res.status(409).json({ success: false, message: "Validasi update kedaluwarsa atau file ZIP berubah. Jalankan validasi ulang sebelum menerapkan." });
    const result = await applyPackage(pkg, repo, admin);
    return res.status(200).json({ success: true, action, manifestHash: pkg.manifestHash, ...result });
  } catch (error) {
    console.error("Admin update error:", error);
    return res.status(error?.status || 500).json({ success: false, message: error?.message || "Gagal memproses update script." });
  }
}
