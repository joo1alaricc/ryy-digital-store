import crypto from "node:crypto";
import { safeUser } from "../_store.js";
import { readDatabase, writeDatabase } from "../_github.js";
import { verifyOTPToken, hashPassword, createUserToken } from "../_auth.js";
import { verifyTurnstile } from "../_turnstile.js";
import { verifySignedRegistrationTicket } from "../_registration.js";
import { ensureWallet } from "../_finance.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ success:false, message:"Method tidak diizinkan." });
  try {
    const { email: rawEmail, otp, otpToken, verificationToken, username: rawUsername, password, turnstileToken } = req.body || {};
    const turnstile = await verifyTurnstile(turnstileToken, req);
    if (!turnstile.success) return res.status(403).json({ success:false, message:turnstile.message || "Verifikasi Cloudflare Turnstile gagal.", code:"TURNSTILE_REQUIRED", errors:turnstile.errors || [] });
    const email = String(rawEmail || "").trim().toLowerCase();
    const username = String(rawUsername || "").trim();
    if (!email || !username || !password) return res.status(400).json({ success:false, message:"Data belum lengkap." });
    let verified=false;
    let verifiedRegistrationRow=null;
    if (verificationToken) { const t=verifySignedRegistrationTicket(verificationToken); if(t?.email===email&&t?.method==="whatsapp"){ const {database:checkDb}=await readDatabase(); const row=(checkDb.pendingRegistrations||[]).find(x=>x.id===t.registrationId&&x.verified===true&&x.email===email); verified=Boolean(row); verifiedRegistrationRow=row||null; } }
    if (!verified) { if(!otp||!otpToken||!verifyOTPToken(otpToken,email.toLowerCase(),otp)) return res.status(400).json({success:false,message:"Verifikasi email/WhatsApp belum selesai."}); }
    if (username.length < 5 || !/[a-zA-Z]/.test(username)) return res.status(400).json({ success:false, message:"Username minimal 5 karakter dan harus mengandung huruf." });
    if (password.length < 8 || !/[a-zA-Z]/.test(password) || !/[0-9]/.test(password) || !/[^a-zA-Z0-9]/.test(password)) return res.status(400).json({ success:false, message:"Password harus minimal 8 karakter dan mengandung huruf, angka, serta simbol." });
    const { database, sha } = await readDatabase();
    database.users ||= [];
    const emailLower = email.toLowerCase();
    if (database.users.some(u => u.username.toLowerCase() === username.toLowerCase())) return res.status(409).json({ success:false, message:"Username sudah digunakan." });
    if (database.users.some(u => u.email.toLowerCase() === emailLower)) return res.status(409).json({ success:false, message:"Email sudah terdaftar." });
    const user = { reseller:false, subscriptions:[], pendingPurchases:[], id:`user_${crypto.randomUUID()}`, username, email:emailLower, phone:"", secondaryContact:"", passwordHash:hashPassword(password), totalItemsBought:0, totalMoneySpent:0, createdAt:new Date().toISOString() }; ensureWallet(user); if(verifiedRegistrationRow?.sn) user.registrationSN=verifiedRegistrationRow.sn;
    database.users.push(user);
    database.settings ||= {};
    database.settings.totalBuyers = database.users.length;
    await writeDatabase(database, sha, `Register user ${username}`);
    return res.status(201).json({ success:true, message:"Registrasi berhasil.", user:safeUser(user), token:createUserToken(user.id) });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success:false, message:"Gagal menyimpan data user." });
  }
}
