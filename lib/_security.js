import crypto from "node:crypto";
import { binding, env } from "./_env.js";

const CHALLENGE_PREFIX = "ryy:security:challenge:";
const RATE_PREFIX = "ryy:security:rate:";
const CHALLENGE_TTL = 300;
const TOKEN_TTL = 12 * 60 * 60 * 1000;
function powDifficulty() { return Math.max(2, Math.min(5, Number(env("SECURITY_POW_DIFFICULTY", "3")) || 3)); }

function kv() {
  const store = binding("STORE_KV");
  return store && typeof store.get === "function" && typeof store.put === "function" ? store : null;
}

function secret() {
  const value = env("APP_SECRET", "");
  if (!value) throw new Error("APP_SECRET belum dikonfigurasi.");
  return value;
}

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function sign(payload) {
  const encoded = encode(payload);
  const signature = crypto.createHmac("sha256", secret()).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function readSigned(token) {
  try {
    const [encoded, signature] = String(token || "").split(".");
    if (!encoded || !signature) return null;
    const expected = crypto.createHmac("sha256", secret()).update(encoded).digest("base64url");
    const a = Buffer.from(signature), b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function clientFingerprint(req) {
  const forwarded = String(req?.headers?.["x-forwarded-for"] || req?.headers?.["x-real-ip"] || "").split(",")[0].trim();
  const ua = String(req?.headers?.["user-agent"] || "");
  const lang = String(req?.headers?.["accept-language"] || "");
  return crypto.createHash("sha256").update(`${forwarded}|${ua}|${lang}`).digest("hex").slice(0, 32);
}

function leadingZeros(hex, difficulty) {
  return hex.startsWith("0".repeat(difficulty));
}

export function securityTokenFromRequest(req) {
  return String(req?.headers?.["x-ryy-security"] || req?.headers?.["x-security-token"] || "").trim();
}

export function verifySecurityToken(token, req = null) {
  const payload = readSigned(token);
  if (!payload || payload.type !== "browser-security" || !payload.jti || !payload.fp) return null;
  if (!Number.isFinite(Number(payload.exp)) || Date.now() > Number(payload.exp)) return null;
  if (req && payload.fp !== clientFingerprint(req)) return null;
  return payload;
}

export function createSecurityToken(challengeId, fingerprint) {
  const now = Date.now();
  return sign({ type: "browser-security", jti: challengeId, fp: fingerprint, iat: now, exp: now + TOKEN_TTL });
}

export async function issueSecurityChallenge(req) {
  const store = kv();
  const id = crypto.randomUUID();
  const nonce = crypto.randomBytes(24).toString("base64url");
  const fp = clientFingerprint(req);
  const createdAt = Date.now();
  if (store) {
    await store.put(`${CHALLENGE_PREFIX}${id}`, JSON.stringify({ nonce, fp, createdAt }), { expirationTtl: CHALLENGE_TTL });
  }
  return { success: true, challengeId: id, nonce, difficulty: powDifficulty(), expiresAt: createdAt + CHALLENGE_TTL * 1000 };
}

export async function verifySecurityChallenge(req, challengeId, nonce, counter, elapsedMs) {
  const id = String(challengeId || "").trim();
  const suppliedNonce = String(nonce || "").trim();
  const n = Number(counter);
  if (!id || !suppliedNonce || !Number.isSafeInteger(n) || n < 0 || n > 50000000) {
    return { success: false, status: 400, message: "Data verifikasi keamanan tidak valid." };
  }
  const store = kv();
  let record = null;
  if (store) {
    record = await store.get(`${CHALLENGE_PREFIX}${id}`, "json");
    if (!record) return { success: false, status: 410, message: "Sesi verifikasi sudah kedaluwarsa. Silakan coba lagi." };
  } else {
    return { success: false, status: 503, message: "Penyimpanan keamanan belum tersedia. Pastikan STORE_KV aktif." };
  }
  if (record.nonce !== suppliedNonce || record.fp !== clientFingerprint(req)) {
    return { success: false, status: 403, message: "Verifikasi keamanan tidak cocok dengan perangkat ini." };
  }
  const age = Date.now() - Number(record.createdAt || 0);
  if (age < 0 || age > CHALLENGE_TTL * 1000) return { success: false, status: 410, message: "Sesi verifikasi sudah kedaluwarsa." };
  const digest = crypto.createHash("sha256").update(`${suppliedNonce}:${n}`).digest("hex");
  if (!leadingZeros(digest, powDifficulty())) {
    return { success: false, status: 400, message: "Bukti verifikasi keamanan tidak valid." };
  }
  if (elapsedMs !== undefined && (!Number.isFinite(Number(elapsedMs)) || Number(elapsedMs) < 0 || Number(elapsedMs) > CHALLENGE_TTL * 1000)) {
    return { success: false, status: 400, message: "Waktu verifikasi tidak valid." };
  }
  await store.delete(`${CHALLENGE_PREFIX}${id}`);
  return { success: true, token: createSecurityToken(id, record.fp), expiresAt: Date.now() + TOKEN_TTL };
}

export async function requireSecurity(req, res) {
  const token = securityTokenFromRequest(req);
  if (!token || !verifySecurityToken(token, req)) {
    return res.status(403).json({ success: false, code: "SECURITY_VERIFICATION_REQUIRED", message: "Verifikasi keamanan diperlukan. Silakan selesaikan verifikasi browser terlebih dahulu." });
  }
  const limit = await rateLimit(req, "protected", 120, 600);
  if (!limit.allowed) {
    res.setHeader("Retry-After", String(limit.retryAfter || 60));
    return res.status(429).json({ success: false, code: "SECURITY_RATE_LIMIT", message: "Terlalu banyak aktivitas dalam waktu singkat. Coba lagi sebentar." });
  }
  return null;
}

export async function rateLimit(req, bucket, limit = 10, windowSeconds = 600) {
  const store = kv();
  if (!store) return { allowed: true, remaining: limit };
  const key = `${RATE_PREFIX}${bucket}:${clientFingerprint(req)}`;
  const now = Date.now();
  const current = await store.get(key, "json");
  if (!current || now >= Number(current.resetAt || 0)) {
    await store.put(key, JSON.stringify({ count: 1, resetAt: now + windowSeconds * 1000 }), { expirationTtl: windowSeconds });
    return { allowed: true, remaining: Math.max(0, limit - 1) };
  }
  const count = Number(current.count || 0) + 1;
  await store.put(key, JSON.stringify({ count, resetAt: current.resetAt }), { expirationTtl: Math.max(1, Math.ceil((Number(current.resetAt) - now) / 1000)) });
  return { allowed: count <= limit, remaining: Math.max(0, limit - count), retryAfter: Math.max(1, Math.ceil((Number(current.resetAt) - now) / 1000)) };
}
