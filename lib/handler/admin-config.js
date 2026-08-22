import { env } from "../_env.js";
import crypto from "node:crypto";
import { readRepoJson, writeRepoJson } from "../_github.js";
import { verifyAdminToken, readAdminConfigKV, writeAdminConfigKV, normalizeAdminRecord, secretDigest } from "../_admin.js";

const CONFIG_PATH = "config.json";
const PRODUCTS_PATH = "produk.json";

function auth(req) {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  return verifyAdminToken(token);
}

function randomCredential(bytes = 18) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function safeConfig(config, admins = []) {
  return {
    maintenance: config?.maintenance === true,
    uiMode: config?.uiMode === "blur" ? "blur" : "liquid-glass",
    font: {
      family: String(config?.font?.family || "san-francisco"),
      weight: Number(config?.font?.weight) || 600
    },
    admins: admins.map(a => ({ username:a.username || "", email:a.email || "", createdAt:a.createdAt || "" }))
  };
}

async function readConfig() {
  try {
    const result = await readRepoJson(CONFIG_PATH);
    return { data: result.data || {}, sha: result.sha };
  } catch (error) {
    if (String(error.message).includes("404")) {
      return { data: { maintenance:false, uiMode:"liquid-glass", font:{family:"san-francisco",weight:600}, admins:[] }, sha:null };
    }
    throw error;
  }
}

async function getPersistentAdmins() {
  const kv = await readAdminConfigKV();
  if (kv.available) return { admins: kv.admins, storage: "kv", initialized: kv.initialized };
  const config = await readConfig();
  const admins = Array.isArray(config.data?.admins) ? config.data.admins.map(normalizeAdminRecord).filter(Boolean) : [];
  return { admins, storage: "github", initialized: Boolean(admins.length) };
}

export default async function handler(req, res) {
  const admin = auth(req);
  if (!admin) return res.status(401).json({ success:false, message:"Sesi admin tidak valid atau sudah kedaluwarsa." });

  try {
    const persistent = await getPersistentAdmins();
    let config = {};
    let sha = null;
    try {
      const result = await readConfig();
      config = result.data || {};
      sha = result.sha;
    } catch (error) {
      // Site settings remain GitHub-backed, but admin credential management
      // must continue working from KV even when GitHub is unavailable.
      console.warn("Site config GitHub unavailable; admin KV remains usable:", error?.message || error);
      config = { maintenance:false, uiMode:"liquid-glass", font:{family:"san-francisco",weight:600} };
    }

    if (req.method === "GET") {
      return res.status(200).json({ success:true, config:safeConfig(config, persistent.admins), storage:persistent.storage });
    }

    if (req.method !== "PATCH" && req.method !== "POST") {
      return res.status(405).json({ success:false, message:"Method tidak diizinkan." });
    }

    const body = req.body || {};
    const action = body.action || "site";

    if (action === "addAdmin") {
      const username = String(body.username || "").trim();
      const email = String(body.email || "").trim().toLowerCase();
      if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username)) return res.status(400).json({ success:false, message:"Username admin tidak valid." });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ success:false, message:"Email admin tidak valid." });

      const admins = [...persistent.admins];
      if (admins.some(a => a.username.toLowerCase() === username.toLowerCase() || (email && a.email.toLowerCase() === email))) {
        return res.status(409).json({ success:false, message:"Admin tersebut sudah terdaftar di konfigurasi." });
      }

      const generated = {
        username,
        email,
        password: randomCredential(12),
        tokenDeveloper: randomCredential(18),
        pin: String(Math.floor(1000 + Math.random() * 9000))
      };
      admins.push({
        username: generated.username,
        email: generated.email,
        passwordHash: secretDigest(generated.password),
        tokenDeveloperHash: secretDigest(generated.tokenDeveloper),
        pinHash: secretDigest(generated.pin),
        createdAt: new Date().toISOString()
      });

      if (persistent.storage === "kv") {
        await writeAdminConfigKV(admins);
      } else {
        config.admins = admins;
        await writeRepoJson(CONFIG_PATH, config, sha, `Admin add administrator ${username}`);
      }

      return res.status(200).json({
        success:true,
        message:"Admin baru ditambahkan. Simpan kredensial berikut karena password/token/PIN hanya ditampilkan sekarang.",
        admin: generated,
        config:safeConfig(config, admins),
        storage:persistent.storage
      });
    }

    if (action === "deleteAdmin") {
      const username = String(body.username || "").trim();
      const admins = persistent.admins.filter(a => a.username !== username);
      if (admins.length === persistent.admins.length) return res.status(404).json({ success:false, message:"Admin konfigurasi tidak ditemukan." });

      // Never allow an admin to remove the last persistent admin through the UI.
      if (!admins.length && persistent.storage === "kv") {
        return res.status(400).json({ success:false, message:"Admin terakhir tidak dapat dihapus." });
      }

      if (persistent.storage === "kv") {
        await writeAdminConfigKV(admins);
      } else {
        config.admins = admins;
        await writeRepoJson(CONFIG_PATH, config, sha, `Admin remove administrator ${username}`);
      }
      return res.status(200).json({ success:true, message:"Admin konfigurasi dihapus.", config:safeConfig(config, admins), storage:persistent.storage });
    }

    if (action === "site") {
      if (body.maintenance !== undefined) config.maintenance = Boolean(body.maintenance);
      if (body.uiMode !== undefined) config.uiMode = body.uiMode === "blur" ? "blur" : "liquid-glass";
      if (body.font) {
        const allowedFamilies = ["sans-serif","san-francisco","roboto","canva-sans"];
        const family = allowedFamilies.includes(String(body.font.family)) ? String(body.font.family) : "san-francisco";
        const weight = [400,500,600,700].includes(Number(body.font.weight)) ? Number(body.font.weight) : 600;
        config.font = { family, weight };
      }

      if (body.storeInfo && typeof body.storeInfo === "object") {
        const { data: products, sha: productSha } = await readRepoJson(PRODUCTS_PATH);
        products.storeInfo ||= {};
        const incoming = body.storeInfo;
        const allowed = ["name","slogan","description","owner","urlPhoto","operatingSince","totalBuyers"];
        for (const key of allowed) if (incoming[key] !== undefined) products.storeInfo[key] = incoming[key];
        const si = products.storeInfo;
        si.i18n ||= { id:{}, en:{}, ko:{} };
        si.i18n.id ||= {};
        si.i18n.id.name = si.name || "";
        si.i18n.id.slogan = si.slogan || "";
        si.i18n.id.description = si.description || "";
        si.i18n.id.owner = si.owner || "";
        si.i18n.id.operatingSince = si.operatingSince || "";
        const { translatePair } = await import("../_translate.js");
        const [slogan, description] = await Promise.all([translatePair(si.slogan || ""), translatePair(si.description || "")]);
        si.i18n.en ||= {};
        si.i18n.ko ||= {};
        si.i18n.en.name = si.name || "";
        si.i18n.ko.name = si.name || "";
        si.i18n.en.slogan = slogan.en;
        si.i18n.ko.slogan = slogan.ko;
        si.i18n.en.description = description.en;
        si.i18n.ko.description = description.ko;
        si.i18n.en.owner = si.owner || "";
        si.i18n.ko.owner = si.owner || "";
        si.i18n.en.operatingSince = si.operatingSince || "";
        si.i18n.ko.operatingSince = si.operatingSince || "";
        await writeRepoJson(PRODUCTS_PATH, products, productSha, `Admin update store configuration by ${admin.username}`);
      }

      if (!sha) return res.status(503).json({ success:false, message:"GitHub belum tersedia untuk menyimpan konfigurasi tampilan. Data admin tetap tersimpan di KV." });
      const written = await writeRepoJson(CONFIG_PATH, config, sha, `Admin update site configuration by ${admin.username}`);
      return res.status(200).json({ success:true, message:"Konfigurasi berhasil disimpan.", config:safeConfig(config, persistent.admins), commit:written, storage:persistent.storage });
    }

    return res.status(400).json({ success:false, message:"Action konfigurasi tidak dikenal." });
  } catch (error) {
    console.error("Admin config error:", error);
    return res.status(503).json({ success:false, message:error?.message || "Gagal menyimpan konfigurasi admin." });
  }
}
