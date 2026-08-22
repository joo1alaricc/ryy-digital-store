import { safeUser } from "../_store.js";
import { readDatabase } from "../_github.js";
import { verifyPassword, createUserToken } from "../_auth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ success: false, message: "Method tidak diizinkan." });
  try {
    const { login, password } = req.body || {};
    const loginInput = String(login || "").trim();
    const passwordInput = String(password || "");
    if (!loginInput || !passwordInput) return res.status(400).json({ success: false, message: "Username/email dan password wajib diisi." });
    const { database } = await readDatabase();
    database.users ||= [];
    const loginLower = loginInput.toLowerCase();
    const user = database.users.find(item => String(item?.username || "").trim().toLowerCase() === loginLower || String(item?.email || "").trim().toLowerCase() === loginLower);
    if (!user || !verifyPassword(passwordInput, user.passwordHash)) return res.status(401).json({ success: false, message: "Username/email atau password salah." });
    return res.status(200).json({ success: true, user: safeUser(user), token: createUserToken(user.id) });
  } catch (error) {
    console.error("User login error:", error);
    return res.status(500).json({
      success: false,
      message: error?.message || "Gagal melakukan login."
    });
  }
}
