import { env } from "./_env.js";
import crypto from "node:crypto";

function sign(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", env("APP_SECRET")).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

export function createAdminToken(admin) {
  return sign({ type: "admin", username: admin.username, exp: Date.now() + 12 * 60 * 60 * 1000 });
}

export function verifyAdminToken(token) {
  try {
    const [encoded, signature] = String(token || "").split(".");
    if (!encoded || !signature || !env("APP_SECRET")) return null;
    const expected = crypto.createHmac("sha256", env("APP_SECRET")).update(encoded).digest("base64url");
    if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (payload.type !== "admin" || Date.now() > payload.exp) return null;
    return payload;
  } catch { return null; }
}

export function getAdminUsers() {
  try {
    const raw = env("ADMIN_USERS");
    if (!raw) return [];
    const users = JSON.parse(raw);
    return Array.isArray(users) ? users : [];
  } catch { return []; }
}

