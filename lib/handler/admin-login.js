import { createAdminToken, credentialsMatch, getAdminUsers, getEnvAdminFallback, readAdminConfigKV, writeAdminConfigKV, normalizeAdminRecord } from "../_admin.js";
import { readRepoJson } from "../_github.js";

function safeAdmin(admin) {
  return { username: String(admin.username || ""), email: String(admin.email || ""), role: String(admin.role || "admin") };
}

function mergeUnique(admins) {
  const map = new Map();
  for (const raw of admins) {
    const admin = normalizeAdminRecord(raw);
    if (!admin) continue;
    const key = `${admin.username.toLowerCase()}|${admin.email.toLowerCase()}`;
    map.set(key, admin);
  }
  return [...map.values()];
}

async function loadConfigAdmins() {
  try {
    const { data } = await readRepoJson("config.json");
    return Array.isArray(data?.admins) ? data.admins : [];
  } catch (error) {
    console.warn("Admin config GitHub unavailable; KV/ENV remain authoritative:", error?.message || error);
    return [];
  }
}

async function buildAdminPool() {
  const kv = await readAdminConfigKV();
  const envAdmins = [getEnvAdminFallback(), ...getAdminUsers()].filter(Boolean);

  // KV is the persistent source. ENV admins are always merged so rotating
  // credentials in Cloudflare does not get blocked by an older KV snapshot.
  let admins = mergeUnique([...kv.admins, ...envAdmins]);

  // On first deployment, migrate existing GitHub config into KV. This is
  // best-effort: authentication must not fail merely because GitHub is down.
  if (kv.available && !kv.initialized) {
    const githubAdmins = await loadConfigAdmins();
    const migrated = mergeUnique([...githubAdmins, ...envAdmins]);
    if (migrated.length) {
      try {
        await writeAdminConfigKV(migrated);
        admins = migrated;
      } catch (error) {
        console.warn("Gagal seed admin ke KV:", error?.message || error);
      }
    }
  }

  return { admins, storage: kv.available ? "kv" : "env/github" };
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

    const pool = await buildAdminPool();
    const admin = pool.admins.find(a => credentialsMatch(a, loginInput, passwordInput, tokenDeveloperInput, pinInput));

    if (!admin) {
      return res.status(401).json({
        success: false,
        message: "Username/email, password, token developer, atau PIN tidak cocok.",
        storage: pool.storage
      });
    }

    const safe = safeAdmin(admin);
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ success: true, admin: safe, token: createAdminToken(safe), next: "#store", storage: pool.storage });
  } catch (error) {
    console.error("Admin login error:", error);
    return res.status(503).json({ success: false, message: error?.message || "Layanan autentikasi admin belum siap." });
  }
}
