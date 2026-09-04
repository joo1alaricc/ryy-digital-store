import { requireSecurity } from "../_security.js";
import { env } from "../_env.js";
import { safeUser } from "../_store.js";
import { readDatabase, writeDatabase } from "../_github.js";
import { verifyPassword, createUserToken } from "../_auth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ success: false, message: "Method tidak diizinkan." });
  const securityError = await requireSecurity(req, res);
  if (securityError) return securityError;

  try {
    const { login, password } = req.body || {};
    const loginInput = String(login || "").trim();
    const passwordInput = String(password || "");

    if (!loginInput || !passwordInput) {
      return res.status(400).json({ success: false, message: "Username/email dan password wajib diisi." });
    }

    const { database, storage } = await readDatabase();
    const users = Array.isArray(database.users) ? database.users : [];
    const loginLower = loginInput.toLowerCase();
    const user = users.find(item =>
      String(item?.username || "").trim().toLowerCase() === loginLower ||
      String(item?.email || "").trim().toLowerCase() === loginLower
    );

    if (!user) {
      return res.status(401).json({ success: false, message: "Username/email atau password salah." });
    }
    user.failedLoginAttempts = Number(user.failedLoginAttempts || 0);
    if (user.status?.banned === true || user.banned === true) return res.status(403).json({ success:false, message:"Akun ini sedang dibanned." });
    if (user.status?.suspended === true || user.suspended === true) return res.status(403).json({ success:false, message:"Akun ini sedang disuspend." });

    let passwordValid = false;
    try {
      passwordValid = verifyPassword(passwordInput, user.passwordHash);
    } catch (error) {
      console.error("Password verification error:", error);
      return res.status(500).json({
        success: false,
        message: "Server tidak dapat memverifikasi password pada runtime Cloudflare.",
        code: "PASSWORD_VERIFY_ERROR"
      });
    }

    if (!passwordValid) {
      user.failedLoginAttempts = Number(user.failedLoginAttempts || 0) + 1;
      try { await writeDatabase(database, null, `Failed login ${user.username}`); } catch (_) {}
      return res.status(401).json({ success: false, message: "Username/email atau password salah." });
    }

    const now = new Date().toISOString();
    const ua = String(req.headers?.["user-agent"] || "");
    user.failedLoginAttempts = 0;
    user.lastLoginAt = now;
    user.lastLoginIp = String(req.headers?.["x-forwarded-for"] || req.headers?.["x-real-ip"] || "").split(",")[0].trim();
    user.lastLoginDevice = /Mobile|Android|iPhone|iPad/i.test(ua) ? "Mobile" : "Desktop";
    user.lastLoginBrowser = /Chrome/i.test(ua) ? "Chrome" : /Firefox/i.test(ua) ? "Firefox" : /Safari/i.test(ua) ? "Safari" : /Edge/i.test(ua) ? "Edge" : "Browser";
    try { await writeDatabase(database, null, `Login ${user.username}`); } catch (_) {}

    const token = createUserToken(user.id);
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      success: true,
      user: safeUser(user),
      token,
      next: "#store",
      storage
    });
  } catch (error) {
    console.error("User login error:", error);
    return res.status(503).json({
      success: false,
      message: error?.message || "Database login tidak tersedia.",
      code: "LOGIN_DATABASE_ERROR"
    });
  }
}
