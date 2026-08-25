import { env, binding } from "./_env.js";
import crypto from "node:crypto";

const ADMIN_KV_KEY = "ryy:admin-config:v1";
const ADMIN_TOKEN_TTL = 12 * 60 * 60 * 1000;

function appSecret() {
  return env("APP_SECRET") || "ryy-store-admin-config";
}

export function secretDigest(value) {
  return crypto.createHmac("sha256", appSecret()).update(String(value ?? "")).digest("hex");
}

function sign(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", appSecret()).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

export function isMainAdmin(admin) {
  const username = String(admin?.username || "").trim().toLowerCase();
  const email = String(admin?.email || "").trim().toLowerCase();
  return username === "admin_utama" || email === "admin1@store.com";
}

export function isSuperAdmin(admin) {
  const role = String(admin?.role || "").toLowerCase();
  if (role === "super" || role === "superadmin") return true;
  // Backward-compatible primary-admin migration for the experimental account.
  // Production deployments should additionally set ADMIN_SUPER_USERS explicitly.
  if (isMainAdmin(admin)) return true;
  const raw = env("ADMIN_SUPER_USERS");
  if (!raw) return false;
  const allowed = raw.split(",").map(v => v.trim().toLowerCase()).filter(Boolean);
  return allowed.includes(String(admin?.username || "").toLowerCase()) || allowed.includes(String(admin?.email || "").toLowerCase());
}

export function createAdminToken(admin) {
  const now = Date.now();
  return sign({
    type: "admin",
    username: String(admin.username || ""),
    email: String(admin.email || ""),
    role: String(admin.role || "admin"),
    iat: now,
    exp: now + ADMIN_TOKEN_TTL
  });
}

export function verifyAdminToken(token) {
  try {
    const [encoded, signature] = String(token || "").split(".");
    if (!encoded || !signature || !env("APP_SECRET")) return null;
    const expected = crypto.createHmac("sha256", appSecret()).update(encoded).digest("base64url");
    if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (payload.type !== "admin" || !payload.username || !Number.isFinite(Number(payload.exp)) || Date.now() > Number(payload.exp)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function getAdminUsers() {
  try {
    const raw = env("ADMIN_USERS");
    if (!raw) return [];
    const users = JSON.parse(raw);
    return Array.isArray(users) ? users : (users && typeof users === "object" ? [users] : []);
  } catch {
    return [];
  }
}

export function getEnvAdminFallback() {
  const username = env("ADMIN_USERNAME").trim();
  const email = env("ADMIN_EMAIL").trim().toLowerCase();
  const password = env("ADMIN_PASSWORD");
  const tokenDeveloper = env("ADMIN_TOKEN_DEVELOPER");
  const pin = env("ADMIN_PIN").trim();
  if (!username && !email) return null;
  return {
    username: username || email,
    email,
    passwordHash: password ? secretDigest(password) : "",
    tokenDeveloperHash: tokenDeveloper ? secretDigest(tokenDeveloper) : "",
    pinHash: pin ? secretDigest(pin) : "",
    role: String(env("ADMIN_ROLE") || "admin"),
    createdAt: "env"
  };
}

export function normalizeAdminRecord(admin) {
  if (!admin || typeof admin !== "object") return null;
  const username = String(admin.username || "").trim();
  const email = String(admin.email || "").trim().toLowerCase();
  if (!username && !email) return null;
  return {
    username: username || email,
    email,
    password: admin.password !== undefined ? String(admin.password) : undefined,
    tokenDeveloper: admin.tokenDeveloper !== undefined ? String(admin.tokenDeveloper) : undefined,
    pin: admin.pin !== undefined ? String(admin.pin).trim() : undefined,
    passwordHash: admin.passwordHash ? String(admin.passwordHash) : "",
    tokenDeveloperHash: admin.tokenDeveloperHash ? String(admin.tokenDeveloperHash) : "",
    pinHash: admin.pinHash ? String(admin.pinHash) : "",
    role: String(
      admin.role ||
      (username.toLowerCase() === "admin_utama" ? "superadmin" : "admin")
    ),
    createdAt: admin.createdAt || ""
  };
}

export function credentialsMatch(admin, loginInput, passwordInput, tokenDeveloperInput, pinInput) {
  const a = normalizeAdminRecord(admin);
  if (!a) return false;
  const login = String(loginInput || "").trim().toLowerCase();
  const username = a.username.toLowerCase();
  const email = a.email.toLowerCase();
  if (username !== login && email !== login) return false;

  const passwordOk = a.password !== undefined
    ? a.password === String(passwordInput || "")
    : Boolean(a.passwordHash) && a.passwordHash === secretDigest(passwordInput);
  const tokenOk = a.tokenDeveloper !== undefined
    ? a.tokenDeveloper === String(tokenDeveloperInput || "")
    : Boolean(a.tokenDeveloperHash) && a.tokenDeveloperHash === secretDigest(tokenDeveloperInput);
  const pinOk = a.pin !== undefined
    ? a.pin === String(pinInput || "").trim()
    : Boolean(a.pinHash) && a.pinHash === secretDigest(pinInput);

  return passwordOk && tokenOk && pinOk;
}

export function getAdminKV() {
  const kv = binding("STORE_KV");
  return kv && typeof kv.get === "function" && typeof kv.put === "function" ? kv : null;
}

export async function readAdminConfigKV() {
  const kv = getAdminKV();
  if (!kv) return { available: false, initialized: false, admins: [] };
  const data = await kv.get(ADMIN_KV_KEY, "json");
  const admins = Array.isArray(data?.admins) ? data.admins.map(normalizeAdminRecord).filter(Boolean) : [];
  return { available: true, initialized: Boolean(data), admins };
}

export async function writeAdminConfigKV(admins) {
  const kv = getAdminKV();
  if (!kv) throw new Error("STORE_KV binding tidak tersedia.");
  const normalized = Array.isArray(admins) ? admins.map(normalizeAdminRecord).filter(Boolean) : [];
  await kv.put(ADMIN_KV_KEY, JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), admins: normalized }));
  return { success: true, storage: "kv", count: normalized.length };
}

export function adminStorageKey() {
  return ADMIN_KV_KEY;
}
