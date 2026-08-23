import { env } from "../_env.js";
import crypto from "node:crypto";
import { readRepoJson, writeRepoJson, readKVJson, writeKVJson } from "../_github.js";
import { verifyAdminToken, readAdminConfigKV, writeAdminConfigKV, normalizeAdminRecord, secretDigest } from "../_admin.js";
import { getOtherTools } from "../other-tools.js";

const CONFIG_PATH = "config.json";
const PRODUCTS_PATH = "produk.json";
const SITE_CONFIG_KV_KEY = "ryy:site-config:v1";
const DEFAULT_TOOLS = getOtherTools();

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
    admins: admins.map(a => ({ username:a.username || "", email:a.email || "", createdAt:a.createdAt || "" })),
    whatsappLink: String(config?.whatsappLink || ""),
    otherTools: DEFAULT_TOOLS.map(tool => { const found = Array.isArray(config?.otherTools) ? config.otherTools.find(x => String(x?.id) === tool.id) : null; return {...tool, enabled: found?.enabled === true}; })
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
    let config = await readKVJson(SITE_CONFIG_KV_KEY);
    let sha = null;
    if(!config || typeof config!=="object") {
      try { const result=await readConfig(); config=result.data||{}; sha=result.sha; } catch (error) {
      // Site settings remain GitHub-backed, but admin credential management
      // must continue working from KV even when GitHub is unavailable.
      console.warn("Site config GitHub unavailable; admin KV remains usable:", error?.message || error);
      config = { maintenance:false, uiMode:"liquid-glass", font:{family:"san-francisco",weight:600} };
      }
    }
    config = config || { maintenance:false, uiMode:"liquid-glass", font:{family:"san-francisco",weight:600} };

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

    if (action === "otherTools") {
      const incoming = Array.isArray(body.tools) ? body.tools : [];
      config.otherTools = DEFAULT_TOOLS.map(tool => {
        const found = incoming.find(x => String(x.id) === tool.id);
        return {...tool, enabled: found?.enabled === true};
      });
      await writeKVJson(SITE_CONFIG_KV_KEY,config);
      return res.status(200).json({success:true,message:"Other Tools diperbarui.",config:safeConfig(config,persistent.admins),storage:"kv"});
    }

    if (action === "broadcast") {
      const { readDatabase, writeDatabase } = await import("../_github.js");
      const { database, sha } = await readDatabase();
      database.users ||= [];
      const status = String(body.status || "UPDATE FITUR").trim().toUpperCase().slice(0,40) || "UPDATE FITUR";
      const now = new Date().toISOString();
      const dateLabel = new Intl.DateTimeFormat("id-ID", {day:"2-digit", month:"2-digit", year:"numeric"}).format(new Date(now));
      const title = `RYY STORE - ${status} - ${dateLabel}`;
      const text = String(body.message || "").trim();
      if(!text) return res.status(400).json({success:false,message:"Isi pemberitahuan wajib diisi."});
      let count=0;
      for(const user of database.users){
        user.inbox = Array.isArray(user.inbox) ? user.inbox : [];
        user.inbox.unshift({id:`broadcast_${crypto.randomUUID()}`,type:"broadcast",title,body:text,status,createdAt:now,read:false,persistent:true});
        count++;
      }
      await writeDatabase(database,sha,`Broadcast ${status} by ${admin.username}`);
      return res.status(200).json({success:true,message:`Pemberitahuan dikirim ke ${count} user.`,count});
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

      if (body.whatsappLink !== undefined) config.whatsappLink = String(body.whatsappLink || "").trim().slice(0,1000);

      if (body.storeInfo && typeof body.storeInfo === "object") {
        try {
          const { readKVJson, writeKVJson, readRepoJson, writeRepoJson, readJsonAsset } = await import("../_github.js");
          const PRODUCT_KV="ryy:products:v1";
          let products=await readKVJson(PRODUCT_KV); let productSha=null;
          if(!products){ try{const gh=await readRepoJson(PRODUCTS_PATH);products=gh.data;productSha=gh.sha;}catch{products=await readJsonAsset(PRODUCTS_PATH);} }
          if(products && typeof products==="object") {
            products.storeInfo ||= {}; const incoming=body.storeInfo; const allowed=["name","slogan","description","owner","urlPhoto","operatingSince","totalBuyers"];
            for(const key of allowed) if(incoming[key]!==undefined) products.storeInfo[key]=incoming[key];
            await writeKVJson(PRODUCT_KV,products);
            try{ if(!productSha){const latest=await readRepoJson(PRODUCTS_PATH);productSha=latest.sha;} await writeRepoJson(PRODUCTS_PATH,products,productSha,`Admin update store configuration by ${admin.username}`); }catch(e){console.warn("Store info GitHub backup failed:",e?.message||e);}
          }
        } catch(e) { console.warn("Store info KV update failed:",e?.message||e); }
      }

      await writeKVJson(SITE_CONFIG_KV_KEY,config);
      let written=null;
      try { if(!sha){ const latest=await readRepoJson(CONFIG_PATH); sha=latest.sha; } written=await writeRepoJson(CONFIG_PATH,config,sha,`Admin update site configuration by ${admin.username}`); } catch(e){ console.warn("Site config GitHub backup failed; KV is authoritative:",e?.message||e); }
      return res.status(200).json({success:true,message:written?"Konfigurasi berhasil disimpan dan disinkronkan ke GitHub.":"Konfigurasi berhasil disimpan ke KV. GitHub backup belum tersedia.",config:safeConfig(config,persistent.admins),commit:written,storage:"kv"});
    }

    return res.status(400).json({ success:false, message:"Action konfigurasi tidak dikenal." });
  } catch (error) {
    console.error("Admin config error:", error);
    return res.status(503).json({ success:false, message:error?.message || "Gagal menyimpan konfigurasi admin." });
  }
}
