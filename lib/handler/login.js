import { safeUser } from "../_store.js";
import { readDatabase } from "../_github.js";
import { verifyPassword, createUserToken } from "../_auth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ success: false, message: "Method tidak diizinkan." });

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
      return res.status(401).json({ success: false, message: "Username/email atau password salah." });
    }

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
