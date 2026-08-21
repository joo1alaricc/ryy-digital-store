import { safeUser } from "../_store.js";
import { readDatabase } from "../_github.js";
import { verifyPassword, createUserToken } from "../_auth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ success: false, message: "Method tidak diizinkan." });
  try {
    const { login, password } = req.body || {};
    if (!login || !password) return res.status(400).json({ success: false, message: "Username/email dan password wajib diisi." });
    const { database } = await readDatabase();
    database.users ||= [];
    const loginLower = login.toLowerCase();
    const user = database.users.find(item => item.username.toLowerCase() === loginLower || item.email.toLowerCase() === loginLower);
    if (!user || !verifyPassword(password, user.passwordHash)) return res.status(401).json({ success: false, message: "Username/email atau password salah." });
    return res.status(200).json({ success: true, user: safeUser(user), token: createUserToken(user.id) });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: "Gagal melakukan login." });
  }
}
