import { env } from "./_env.js";
import crypto from "node:crypto";

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.includes(":")) return false;
  const [salt, originalHash] = storedHash.split(":");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(originalHash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function generateOTP() {
  return crypto.randomInt(1000, 10000).toString();
}

function signPayload(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", env("APP_SECRET")).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function verifySignedPayload(token) {
  const [encoded, signature] = String(token || "").split(".");
  if (!encoded || !signature || !env("APP_SECRET")) return null;
  const expected = crypto.createHmac("sha256", env("APP_SECRET")).update(encoded).digest("base64url");
  const a = Buffer.from(signature), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
}

export function createOTPToken(email, otp) {
  return signPayload({ email, otpHash: crypto.createHash("sha256").update(otp).digest("hex"), expiresAt: Date.now() + 5 * 60 * 1000, type: "otp" });
}

export function verifyOTPToken(token, email, otp) {
  try {
    const payload = verifySignedPayload(token);
    if (!payload || payload.type !== "otp" || payload.email !== email || Date.now() > payload.expiresAt) return false;
    const otpHash = crypto.createHash("sha256").update(otp).digest("hex");
    return crypto.timingSafeEqual(Buffer.from(payload.otpHash), Buffer.from(otpHash));
  } catch { return false; }
}

export function createUserToken(userId) {
  return signPayload({ type: "user", userId, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 });
}

export function verifyUserToken(token) {
  try {
    const payload = verifySignedPayload(token);
    if (!payload || payload.type !== "user" || !payload.userId || Date.now() > payload.exp) return null;
    return payload;
  } catch { return null; }
}
