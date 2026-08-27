import crypto from "node:crypto";
import { readRepoJson, writeRepoJson, readKVJson, writeKVJson, readJsonAsset } from "../_github.js";
import { verifyAdminToken, isMainAdmin } from "../_admin.js";
import { normalizeProduct, normalizeCatalog, productStock } from "../_store.js";
import { translatePair } from "../_translate.js";

const PRODUCTS_PATH = "produk.json";
const PRODUCTS_KV_KEY = "ryy:products:v1";

function auth(req) {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  return verifyAdminToken(token);
}

function requireMainAdmin(admin) {
  return isMainAdmin(admin);
}

function numberOr(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

async function localizeProduct(product) {
  const name = String(product.name || "");
  const description = String(product.description || "");
  const [nameT, descT] = await Promise.all([translatePair(name), translatePair(description)]);

  product.i18n = {
    id: { name, description },
    en: { name: nameT.en, description: descT.en },
    ko: { name: nameT.ko, description: descT.ko }
  };

  const types = Array.isArray(product.types) ? product.types : [];
  await Promise.all(types.map(async type => {
    const typeName = String(type.typeName || "");
    const t = await translatePair(typeName);
    type.i18n = {
      id: { typeName },
      en: { typeName: t.en },
      ko: { typeName: t.ko }
    };
  }));
  product.types = types;
  product.stock = productStock(product);
  return product;
}

function sanitizeProduct(body, existing = {}) {
  const rawId = body.id ?? existing.id;
  const id = String(rawId ?? "").trim();
  if (!/^([0-9]+)$/.test(id) || Number(id) <= 0) throw new Error("ID produk harus berupa angka positif.");

  const name = String(body.name ?? existing.name ?? "").trim();
  const category = String(body.category ?? existing.category ?? "").trim();
  const description = String(body.description ?? existing.description ?? "").trim();
  if (!name || !category || !description) throw new Error("Nama, kategori, dan deskripsi wajib diisi.");

  const types = Array.isArray(body.types) ? body.types : (Array.isArray(existing.types) ? existing.types : []);
  if (!types.length) throw new Error("Minimal satu tipe produk wajib diisi.");

  const normalizedTypes = types.map((raw, index) => {
    const typeName = String(raw?.typeName || "").trim();
    const price = Math.max(0, Math.floor(numberOr(raw?.price, 0)));
    const stock = Math.max(0, Math.floor(numberOr(raw?.stock, 0)));
    const durationRaw = raw?.durationDays;
    const durationDays = durationRaw === "" || durationRaw === null || durationRaw === undefined
      ? null
      : Math.max(0, numberOr(durationRaw, 0));
    if (!typeName) throw new Error(`Nama tipe ke-${index + 1} wajib diisi.`);
    return { typeName, price, stock, durationDays };
  });

  const options = Array.isArray(body.options) ? body.options.map(v=>String(v||"").trim()).filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i) : (Array.isArray(existing.options)?existing.options:[]);
  const incomingOptionPrices = body.optionPrices && typeof body.optionPrices === "object" && !Array.isArray(body.optionPrices) ? body.optionPrices : existing.optionPrices;
  const optionPrices = {};
  for (const option of options) {
    const n = Number(incomingOptionPrices?.[option] ?? 0);
    optionPrices[option] = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  }
  const allowedParameters = new Set(["email","emailPassword","mlId","ffId","meterNumber","phone","ewalletNumber"]);
  const parameters = Array.isArray(body.parameters) ? [...new Set(body.parameters.map(String).filter(k=>allowedParameters.has(k)))] : (Array.isArray(existing.parameters)?existing.parameters:[]);
  return {
    ...existing,
    id,
    name,
    category,
    description,
    image: String(body.image ?? existing.image ?? "").trim(),
    bestSeller: Boolean(body.bestSeller),
    options,
    optionPrices,
    parameters,
    types: normalizedTypes
  };
}

export default async function handler(req, res) {
  const admin = auth(req);
  if (!admin) return res.status(401).json({ success:false, message:"Sesi admin tidak valid atau sudah kedaluwarsa." });
  if (!isMainAdmin(admin)) return res.status(403).json({success:false,message:"Akses ini hanya tersedia untuk admin utama."});

  try {
    let data=null; let sha=null; let source="kv";
    const cached=await readKVJson(PRODUCTS_KV_KEY);
    if(cached && typeof cached === "object") data=cached;
    if(!data){
      // Product catalog must remain available even when GitHub configuration/backup is unavailable.
      // The deployed produk.json is the authoritative initial seed; KV becomes the writable primary store.
      data=await readJsonAsset(PRODUCTS_PATH);
      source="asset";
      if(!data || typeof data!=="object") {
        try{ const gh=await readRepoJson(PRODUCTS_PATH); data=gh.data; sha=gh.sha; source="github"; }
        catch(e){ console.warn("Products asset/GitHub unavailable:",e?.message||e); }
      }
      if(!data || typeof data!=="object") throw new Error("Katalog produk tidak tersedia.");
      try{await writeKVJson(PRODUCTS_KV_KEY,data);}catch(e){console.warn("Gagal seed produk ke KV:",e?.message||e);}
    }

    data=normalizeCatalog(data);
    if (req.method === "GET") {
      try{await writeKVJson(PRODUCTS_KV_KEY,data);}catch{}
      return res.status(200).json({success:true,categories:data.categories,products:data.products.map(normalizeProduct),storage:"kv"});
    }

    if (!["POST","PATCH","DELETE"].includes(req.method)) {
      return res.status(405).json({ success:false, message:"Method tidak diizinkan." });
    }

    if (req.method === "DELETE") {
      const id = String(req.query?.id ?? "").trim();
      const index = data.products.findIndex(p => String(p.id) === id || String(p.id).replace(/^0+(?=\d)/,"") === id.replace(/^0+(?=\d)/,""));
      if (index < 0) return res.status(404).json({ success:false, message:"Produk tidak ditemukan." });
      const removed = data.products.splice(index,1)[0];
      data.categories = ["Semua", ...new Set(data.products.map(p => String(p.category || "").trim()).filter(Boolean))];
      await writeKVJson(PRODUCTS_KV_KEY, data);
      try { const latest=sha ? {sha} : await readRepoJson(PRODUCTS_PATH); await writeRepoJson(PRODUCTS_PATH,data,latest.sha,`Admin delete product ${removed.name||id}`); } catch(e){ console.warn("GitHub product backup failed:",e?.message||e); }
      return res.status(200).json({ success:true, message:"Produk dihapus.", products:data.products.map(normalizeProduct), categories:data.categories });
    }

    const body = req.body || {};
    let product;
    if (req.method === "POST") {
      const ids = data.products.map(p => Number(p.id)).filter(Number.isFinite);
      const suggestedId = String(ids.length ? Math.max(...ids) + 1 : 1).padStart(2,"0");
      product = sanitizeProduct({ ...body, id: body.id || suggestedId });
      if (data.products.some(p => String(p.id) === String(product.id))) {
        return res.status(409).json({ success:false, message:`ID produk ${product.id} sudah digunakan.` });
      }
      product = await localizeProduct(product);
      data.products.push(product);
    } else {
      const id = String(body.id ?? "").trim();
      const index = data.products.findIndex(p => String(p.id) === id || String(p.id).replace(/^0+(?=\d)/,"") === id.replace(/^0+(?=\d)/,""));
      if (index < 0) return res.status(404).json({ success:false, message:"Produk tidak ditemukan." });
      product = sanitizeProduct(body, data.products[index]);
      product = await localizeProduct(product);
      data.products[index] = product;
    }

    const category = String(product.category || "").trim();
    if (category && !data.categories.includes(category)) data.categories.push(category);
    if (!data.categories.includes("Semua")) data.categories.unshift("Semua");
    data.categories = [...new Set(data.categories)];

    await writeKVJson(PRODUCTS_KV_KEY,data);
    try { const latest=sha ? {sha} : await readRepoJson(PRODUCTS_PATH); await writeRepoJson(PRODUCTS_PATH,data,latest.sha,`Admin ${req.method === "POST" ? "add" : "update"} product ${product.name}`); } catch(e){ console.warn("GitHub product backup failed:",e?.message||e); }
    return res.status(200).json({
      success:true,
      message:req.method === "POST" ? "Produk berhasil ditambahkan." : "Produk berhasil diperbarui.",
      product:normalizeProduct(product),
      products:data.products.map(normalizeProduct),
      categories:data.categories
    });
  } catch (error) {
    console.error("Admin products error:", error);
    return res.status(500).json({ success:false, message:error?.message || "Gagal memproses produk." });
  }
}
