import { env } from "../_env.js";
import { createAdminToken, getAdminUsers } from "../_admin.js";
import { readRepoJson } from "../_github.js";
import crypto from "node:crypto";

function secretDigest(value) {
  return crypto.createHmac("sha256", env("APP_SECRET") || "ryy-store-admin-config")
    .update(String(value || ""))
    .digest("hex");
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ success: false, message: "Method tidak diizinkan." });
  try {
    const { login, password, tokenDeveloper, pin } = req.body || {};
    const loginInput = String(login || "").trim().toLowerCase();
    const passwordInput = String(password || "");
    const tokenDeveloperInput = String(tokenDeveloper || "");
    const pinInput = String(pin || "").trim();
    if (!loginInput || !passwordInput || !tokenDeveloperInput || !pinInput) {
      return res.status(400).json({ success: false, message: "Username/email, password, token developer, dan PIN wajib diisi." });
    }
    const envAdmins = getAdminUsers();
    let configAdmins = [];
    try {
      const { data } = await readRepoJson("config.json");
      configAdmins = Array.isArray(data?.admins) ? data.admins : [];
    } catch (_) {}

    const admins = [...envAdmins, ...configAdmins];
    const admin = admins.find(a => {
      const username = String(a.username || "").trim().toLowerCase();
      const email = String(a.email || "").trim().toLowerCase();
      if (username !== loginInput && email !== loginInput) return false;
      const passwordOk = a.password !== undefined
        ? String(a.password) === passwordInput
        : a.passwordHash === secretDigest(passwordInput);
      const tokenOk = a.tokenDeveloper !== undefined
        ? String(a.tokenDeveloper) === tokenDeveloperInput
        : a.tokenDeveloperHash === secretDigest(tokenDeveloperInput);
      const pinOk = a.pin !== undefined
        ? String(a.pin).trim() === pinInput
        : a.pinHash === secretDigest(pinInput);
      return passwordOk && tokenOk && pinOk;
    });
    if (!admin) return res.status(401).json({ success: false, message: "Data Admin, Token Developer, atau PIN tidak cocok." });
    const safeAdmin = { username: admin.username, email: admin.email };
    return res.status(200).json({ success: true, admin: safeAdmin, token: createAdminToken(safeAdmin) });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: "Gagal melakukan login admin." });
  }
}
