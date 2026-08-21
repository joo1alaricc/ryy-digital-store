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
    const envAdmins = getAdminUsers();
    let configAdmins = [];
    try {
      const { data } = await readRepoJson("config.json");
      configAdmins = Array.isArray(data?.admins) ? data.admins : [];
    } catch (_) {}

    const admins = [...envAdmins, ...configAdmins];
    const admin = admins.find(a => {
      if (a.username !== login && a.email !== login) return false;
      const passwordOk = a.password !== undefined
        ? a.password === password
        : a.passwordHash === secretDigest(password);
      const tokenOk = a.tokenDeveloper !== undefined
        ? a.tokenDeveloper === tokenDeveloper
        : a.tokenDeveloperHash === secretDigest(tokenDeveloper);
      const pinOk = a.pin !== undefined
        ? a.pin === pin
        : a.pinHash === secretDigest(pin);
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
