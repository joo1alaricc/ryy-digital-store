import { env, binding } from "./_env.js";
import initialDatabase from "../data/database.json";

const GITHUB_API = "https://api.github.com";
const DATABASE_KV_KEY = "ryy:database:v1";
const DATABASE_ASSET = "/data/database.json";

function githubConfig() {
  const config = {
    token: env("GITHUB_TOKEN"),
    owner: env("GITHUB_OWNER"),
    repo: env("GITHUB_REPO"),
    branch: env("GITHUB_BRANCH") || "main",
    path: env("GITHUB_PATH") || "data/database.json"
  };
  const missing = ["GITHUB_TOKEN", "GITHUB_OWNER", "GITHUB_REPO"].filter(key => !config[key]);
  return { ...config, missing };
}

function getKV() {
  const kv = binding("STORE_KV");
  return kv && typeof kv.get === "function" && typeof kv.put === "function" ? kv : null;
}

async function readDatabaseFromAsset() {
  const assets = binding("ASSETS");
  if (!assets || typeof assets.fetch !== "function") return null;

  const response = await assets.fetch(new Request(new URL(DATABASE_ASSET, "https://ryy-store.internal")));
  if (!response.ok) return null;

  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("data/database.json bukan JSON yang valid.");
  }
}

function cloneInitialDatabase() {
  // Keep the bundled seed private: data/database.json is not published as a
  // static asset, but is bundled into the Worker as the last-resort seed.
  return JSON.parse(JSON.stringify(initialDatabase));
}

async function githubRequest(url, options = {}) {
  const config = githubConfig();
  if (config.missing.length) {
    throw new Error(`Konfigurasi GitHub belum lengkap: ${config.missing.join(", ")}.`);
  }

  const response = await fetch(`${GITHUB_API}${url}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${config.token}`,
      // 2026-03-10 is currently supported by GitHub. Keeping this explicit
      // avoids depending on a moving default API version.
      "X-GitHub-Api-Version": "2026-03-10",
      "User-Agent": "RYY-Digital-Store/2.0",
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }

  if (!response.ok) {
    throw new Error(`GitHub API ${response.status}: ${typeof data === "string" ? data : data.message || "Unknown error"}`);
  }
  return data;
}

async function readDatabaseFromGitHub() {
  const config = githubConfig();
  if (config.missing.length) throw new Error(`Konfigurasi GitHub belum lengkap: ${config.missing.join(", ")}.`);

  const data = await githubRequest(
    `/repos/${config.owner}/${config.repo}/contents/${config.path}?ref=${encodeURIComponent(config.branch)}`
  );

  const content = Buffer.from(data.content, "base64").toString("utf8");
  return { database: JSON.parse(content), sha: data.sha };
}

/**
 * Database strategy for Cloudflare Pages:
 * 1) STORE_KV is the primary writable store, so login/register do not depend
 *    on GitHub being reachable from the Worker.
 * 2) On first use, KV is seeded from GitHub when configured, then a deployed
 *    asset if available, and finally the bundled private seed.
 * 3) GitHub remains an optional backup/sync target for existing admin tooling.
 */
export async function readDatabase() {
  const kv = getKV();

  if (kv) {
    const cached = await kv.get(DATABASE_KV_KEY, "json");
    if (cached && typeof cached === "object") {
      return { database: cached, sha: null, storage: "kv" };
    }

    let seed = null;
    let seedSha = null;

    try {
      const gh = await readDatabaseFromGitHub();
      seed = gh.database;
      seedSha = gh.sha;
    } catch (error) {
      console.warn("GitHub seed unavailable, trying static database asset:", error?.message || error);
    }

    if (!seed) seed = await readDatabaseFromAsset();
    if (!seed) seed = cloneInitialDatabase();
    if (!seed || typeof seed !== "object") {
      throw new Error("Database awal tidak tersedia.");
    }

    await kv.put(DATABASE_KV_KEY, JSON.stringify(seed));
    return { database: seed, sha: seedSha, storage: "kv", seededFrom: seedSha ? "github" : "bundled" };
  }

  // Backward-compatible fallback for deployments where STORE_KV is not bound.
  try {
    return await readDatabaseFromGitHub();
  } catch (error) {
    console.warn("GitHub database unavailable, trying bundled seed:", error?.message || error);
    const assetDatabase = await readDatabaseFromAsset();
    if (assetDatabase) return { database: assetDatabase, sha: null, storage: "asset" };
    return { database: cloneInitialDatabase(), sha: null, storage: "bundled" };
  }
}

export async function writeDatabase(database, sha, message) {
  const kv = getKV();

  if (kv) {
    await kv.put(DATABASE_KV_KEY, JSON.stringify(database));

    // GitHub is now best-effort. A GitHub outage must not break login,
    // registration, profile updates, checkout, or admin actions when KV works.
    const config = githubConfig();
    if (!config.missing.length && sha) {
      try {
        await writeDatabaseToGitHub(database, sha, message);
      } catch (error) {
        console.warn("GitHub backup sync failed; KV write succeeded:", error?.message || error);
      }
    }

    return { success: true, sha: null, storage: "kv" };
  }

  let targetSha = sha;
  if (!targetSha) {
    const latest = await readDatabaseFromGitHub();
    targetSha = latest.sha;
  }
  return writeDatabaseToGitHub(database, targetSha, message);
}

async function writeDatabaseToGitHub(database, sha, message) {
  const config = githubConfig();
  if (config.missing.length) {
    throw new Error(`Konfigurasi GitHub belum lengkap: ${config.missing.join(", ")}.`);
  }
  if (!sha) throw new Error("SHA database GitHub tidak tersedia untuk penulisan.");

  const content = Buffer.from(JSON.stringify(database, null, 2), "utf8").toString("base64");
  return githubRequest(`/repos/${config.owner}/${config.repo}/contents/${config.path}`, {
    method: "PUT",
    body: JSON.stringify({ message, content, sha, branch: config.branch })
  });
}


export function getStorageKV() { return getKV(); }

export async function readJsonAsset(path) {
  const assets = binding("ASSETS");
  if (!assets || typeof assets.fetch !== "function") return null;
  const clean = String(path || "").replace(/^\/+/, "");
  const response = await assets.fetch(new Request(new URL(`/${clean}`, "https://ryy-store.internal")));
  if (!response.ok) return null;
  const text = await response.text();
  try { return JSON.parse(text); } catch { return null; }
}

export async function readKVJson(key) {
  const kv = getKV();
  if (!kv) return null;
  return await kv.get(String(key), "json");
}

export async function writeKVJson(key, value) {
  const kv = getKV();
  if (!kv) throw new Error("STORE_KV binding tidak tersedia.");
  await kv.put(String(key), JSON.stringify(value));
  return { success:true, storage:"kv" };
}

export async function writeRepoJson(path, jsonData, sha, message) {
  const config = githubConfig();
  const repoPath = String(path || "").replace(/^\/+/, "");
  const content = Buffer.from(JSON.stringify(jsonData, null, 2), "utf8").toString("base64");

  return githubRequest(`/repos/${config.owner}/${config.repo}/contents/${repoPath}`, {
    method: "PUT",
    body: JSON.stringify({ message, content, sha, branch: config.branch })
  });
}

export async function readRepoJson(path) {
  const config = githubConfig();
  if (config.missing.length) throw new Error(`Konfigurasi GitHub belum lengkap: ${config.missing.join(", ")}.`);
  const repoPath = String(path || "").replace(/^\/+/, "");

  const data = await githubRequest(
    `/repos/${config.owner}/${config.repo}/contents/${repoPath}?ref=${encodeURIComponent(config.branch)}`
  );

  const content = Buffer.from(data.content, "base64").toString("utf8");
  return { data: JSON.parse(content), sha: data.sha };
}

export async function databaseStorageStatus() {
  const kv = getKV();
  if (kv) {
    const cached = await kv.get(DATABASE_KV_KEY);
    return { primary: "kv", initialized: Boolean(cached) };
  }
  const config = githubConfig();
  return { primary: "github", initialized: config.missing.length === 0, missing: config.missing, seedAvailable: true };
}
