import { safeUser } from "../_store.js";
import { binding } from "../_env.js";
import { verifyPassword, createUserToken } from "../_auth.js";

const DATABASE_KV_KEY = "ryy:database:v1";
const DATABASE_ASSET = "/data/database.json";

async function loadDatabaseForLogin() {
  const kv = binding("STORE_KV");
  if (kv && typeof kv.get === "function") {
    const cached = await kv.get(DATABASE_KV_KEY, "json");
    if (cached && typeof cached === "object") return { database: cached, storage: "kv" };
  }

  const assets = binding("ASSETS");
  if (!assets || typeof assets.fetch !== "function") {
    throw new Error("Cloudflare ASSETS binding tidak tersedia.");
  }

  const response = await assets.fetch(new Request(new URL(DATABASE_ASSET, "https://ryy-store.internal")));
  if (!response.ok) {
    throw new Error(`Database asset tidak ditemukan (HTTP ${response.status}).`);
  }

  let database;
  try {
    database = await response.json();
  } catch {
    throw new Error("data/database.json tidak valid.");
  }

  if (!database || typeof database !== "object") {
    throw new Error("Format database tidak valid.");
  }

  if (kv && typeof kv.put === "function") {
    try { await kv.put(DATABASE_KV_KEY, JSON.stringify(database)); }
    catch (error) { console.warn("KV seed saat login gagal:", error?.message || error); }
  }

  return { database, storage: "asset" };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ success: false, message: "Method tidak diizinkan." });

  try {
    const { login, password } = req.body || {};
    const loginInput = String(login || "").trim();
    const passwordInput = String(password || "");

    if (!loginInput || !passwordInput) {
      return res.status(400).json({ success: false, message: "Username/email dan password wajib diisi." });
    }

    const { database, storage } = await loadDatabaseForLogin();
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
