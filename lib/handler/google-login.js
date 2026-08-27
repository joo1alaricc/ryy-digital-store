import { env } from "../_env.js";
import crypto from "node:crypto";
import { safeUser } from "../_store.js";
import { readDatabase, writeDatabase } from "../_github.js";
import { hashPassword } from "../_auth.js";
import { createRegistrationTicket } from "../_registration.js";
import { verifyTurnstile } from "../_turnstile.js";

function cleanUsername(value) {
  const base = String(value || "user").toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 18) || "user";
  return base;
}

async function makeUniqueUsername(database, preferred) {
  const existing = new Set((database.users || []).map(u => String(u.username || "").toLowerCase()));
  const base = cleanUsername(preferred);
  if (!existing.has(base)) return base;
  for (let i = 2; i <= 9999; i++) {
    const candidate = `${base.slice(0, Math.max(1, 20 - String(i).length))}${i}`;
    if (!existing.has(candidate)) return candidate;
  }
  return `user_${crypto.randomUUID().slice(0, 8)}`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ success: false, message: "Method tidak diizinkan." });
  try {
    const { credential, turnstileToken } = req.body || {};
    const turnstile = await verifyTurnstile(turnstileToken, req);
    if (!turnstile.success) return res.status(403).json({success:false,message:turnstile.message||"Verifikasi Cloudflare Turnstile gagal.",code:"TURNSTILE_REQUIRED"});
    if (!credential) return res.status(400).json({ success: false, message: "Credential Google tidak ditemukan." });
    if (!env("GOOGLE_CLIENT_ID")) return res.status(500).json({ success: false, message: "GOOGLE_CLIENT_ID belum diset." });
    const verifyResponse = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
    const payload = await verifyResponse.json();
    if (!verifyResponse.ok) throw new Error("Google credential tidak valid.");
    const expectedClientId = env("GOOGLE_CLIENT_ID").trim();
    const audience = String(payload?.aud || "").trim();
    const issuer = String(payload?.iss || "").trim();
    const emailVerified = payload?.email_verified === true || String(payload?.email_verified || "").toLowerCase() === "true";

    if (!audience || audience !== expectedClientId) {
      return res.status(401).json({ success: false, message: "Google audience tidak cocok dengan GOOGLE_CLIENT_ID Cloudflare." });
    }
    if (issuer && issuer !== "accounts.google.com" && issuer !== "https://accounts.google.com") {
      return res.status(401).json({ success: false, message: "Penerbit credential Google tidak valid." });
    }
    if (!payload?.sub || !payload.email || !emailVerified) {
      return res.status(401).json({ success: false, message: "Akun Google tidak dapat diverifikasi oleh Google." });
    }

    const email = payload.email.toLowerCase();
    const googleId = payload.sub;
    const { database, sha } = await readDatabase();
    database.users ||= [];

    let user = database.users.find(u => u.googleId === googleId || String(u.email || "").toLowerCase() === email);
    let changed = false;

    if (user) {
      if (user.status?.banned === true || user.banned === true) return res.status(403).json({success:false,message:"Akun ini sedang dibanned."});
      if (user.status?.suspended === true || user.suspended === true) return res.status(403).json({success:false,message:"Akun ini sedang disuspend."});
      if (!user.googleId) { user.googleId = googleId; changed = true; }
      if (!user.googleEmail) { user.googleEmail = email; changed = true; }
      if (payload.picture && !user.avatar) { user.avatar = payload.picture; changed = true; }
      if (payload.name && !user.displayName) { user.displayName = payload.name; changed = true; }
    } else {
      const username = await makeUniqueUsername(database, email.split("@")[0] || payload.name);
      user = {
        id: `user_${crypto.randomUUID()}`,
        username,
        email,
        phone: "",
        secondaryContact: "",
        passwordHash: hashPassword(crypto.randomUUID()),
        googleId,
        googleEmail: email,
        displayName: payload.name || username,
        avatar: payload.picture || "",
        totalItemsBought: 0,
        totalMoneySpent: 0,
        createdAt: new Date().toISOString(),
        authProvider: "google",
        reseller: false,
        subscriptions: [],
        pendingPurchases: []
      };
      database.users.push(user);
      database.settings ||= {};
      database.settings.totalBuyers = database.users.length;
      changed = true;
    }

    const verificationToken = createRegistrationTicket({type:"google_verify",userId:user.id,email});
    user.googlePendingVerification = true;
    changed = true;
    await writeDatabase(database, sha, `Google verification pending ${user.username}`);

    return res.status(200).json({ success:true, verificationRequired:true, verificationToken, email, user:safeUser(user), methods:["otp","whatsapp"] });
  } catch (error) {
    console.error("Google login error:", error);
    const message = error?.message || "Login Google gagal atau credential sudah tidak valid.";
    const status = /database|KV|GitHub|write|token/i.test(message) ? 500 : 401;
    return res.status(status).json({ success: false, message });
  }
}
