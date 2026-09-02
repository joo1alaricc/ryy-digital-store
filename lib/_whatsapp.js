import { env, binding } from "./_env.js";

const GATEWAY_KV_KEY = "ryy:whatsapp-gateways:v2";

function kv() {
  const store = binding("STORE_KV");
  return store && typeof store.get === "function" && typeof store.put === "function" ? store : null;
}

function cleanPhone(value) {
  return String(value || "").replace(/\D/g, "");
}

export function extractGatewayPhone(status) {
  const raw = String(
    status?.number
    ?? status?.data?.number
    ?? status?.phone
    ?? status?.data?.phone
    ?? status?.jid
    ?? status?.data?.jid
    ?? ""
  ).trim();
  // Baileys commonly exposes a device suffix such as 628xxxx:59@s.whatsapp.net.
  const base = raw.split("@")[0].split(":")[0];
  return cleanPhone(base);
}

function normalizeGateway(raw) {
  if (!raw || typeof raw !== "object") return null;
  const adminUsername = String(raw.adminUsername || "").trim();
  const adminEmail = String(raw.adminEmail || "").trim().toLowerCase();
  const id = String(raw.id || `gateway-${adminUsername || adminEmail || "unknown"}`).trim();
  const bridgeUrl = String(raw.bridgeUrl || "").trim().replace(/\/+$/, "");
  const botId = String(raw.botId || "").trim();
  const ownerPhone = cleanPhone(raw.ownerPhone);
  if (!adminUsername && !adminEmail) return null;
  return {
    id, adminUsername, adminEmail,
    botName: String(raw.botName || "RYY WhatsApp Gateway").trim(),
    botId,
    bridgeUrl,
    ownerPhone,
    profileName: String(raw.profileName || "").trim(),
    enabled: raw.enabled !== false,
    createdAt: raw.createdAt || new Date().toISOString(),
    updatedAt: raw.updatedAt || new Date().toISOString(),
    secretConfigured: Boolean(raw.bridgeSecret || raw.secretConfigured)
  };
}

async function readRegistry() {
  const store = kv();
  if (!store) return { available:false, initialized:false, gateways:[] };
  const data = await store.get(GATEWAY_KV_KEY, "json");
  const gateways = Array.isArray(data?.gateways)
    ? data.gateways.map(normalizeGateway).filter(Boolean)
    : [];
  return { available:true, initialized:Boolean(data), gateways };
}

async function writeRegistry(gateways) {
  const store = kv();
  if (!store) throw new Error("STORE_KV binding tidak tersedia.");
  const safe = gateways.map(normalizeGateway).filter(Boolean);
  await store.put(GATEWAY_KV_KEY, JSON.stringify({
    version:2,
    updatedAt:new Date().toISOString(),
    gateways:safe
  }));
  return safe;
}

function envMainGateway() {
  const url = env("BOT_BRIDGE_URL").trim().replace(/\/+$/, "");
  const secret = env("BOT_BRIDGE_SECRET");
  const botId = env("BOT_ID", "ryy-wa-01");
  const ownerPhone = cleanPhone(env("BOT_OWNER_PHONE") || "6285862364581");
  const adminEmail = String(env("ADMIN_EMAIL") || "").trim().toLowerCase();
  return normalizeGateway({
    id:"gateway-main",
    adminUsername:"admin_utama",
    adminEmail:adminEmail || "admin1@store.com",
    botName:env("BOT_NAME") || "RYY Main Bot",
    botId,
    bridgeUrl:url,
    ownerPhone,
    profileName:env("BOT_PROFILE_NAME") || "RYY Store Bot",
    enabled:true,
    bridgeSecret:secret
  });
}

function gatewayRecordWithSecret(gateway, secret) {
  return {
    ...gateway,
    bridgeSecret: secret || ""
  };
}

export async function getGateways() {
  const reg = await readRegistry();
  const gateways = [...reg.gateways];
  const main = envMainGateway();
  if (main && !gateways.some(g => g.id === main.id || (String(g.adminUsername).toLowerCase()==="admin_utama"))) gateways.unshift(main);
  return gateways;
}

export async function getGatewayByAdmin(admin) {
  const username = String(admin?.username || "").trim().toLowerCase();
  const email = String(admin?.email || "").trim().toLowerCase();
  const gateways = await getGateways();
  return gateways.find(g =>
    (username && String(g.adminUsername || "").toLowerCase() === username) ||
    (email && String(g.adminEmail || "").toLowerCase() === email)
  ) || (username === "admin_utama" ? gateways.find(g => g.adminUsername === "admin_utama") : null);
}

export async function getMainGateway() {
  const gateways = await getGateways();
  return gateways.find(g => String(g.adminUsername).toLowerCase() === "admin_utama")
    || gateways.find(g => String(g.adminEmail).toLowerCase() === "admin1@store.com")
    || gateways[0]
    || null;
}

export async function getConnectedMainGateway() {
  const gateway = await getMainGateway();
  if (!gateway) return { gateway: null, status: null, connected: false };
  try {
    const status = await gatewayFetch(gateway, "/status", { method: "GET" });
    const connected = status?.connected === true
      || String(status?.status || "").toLowerCase() === "connected"
      || status?.data?.connected === true
      || String(status?.data?.status || "").toLowerCase() === "connected";
    return { gateway, status, connected };
  } catch (error) {
    return { gateway, status: null, connected: false, error };
  }
}

export function extractWhatsAppMessageText(message) {
  if (!message || typeof message !== "object") return "";
  const nested = message.message && typeof message.message === "object" ? message.message : null;
  return String(
    message.text
    ?? message.body
    ?? message.caption
    ?? message.messageText
    ?? nested?.conversation
    ?? nested?.extendedTextMessage?.text
    ?? nested?.imageMessage?.caption
    ?? ""
  );
}

export function extractWhatsAppMessageSender(message) {
  if (!message || typeof message !== "object") return "";
  const raw = String(
    message.sender
    ?? message.chat
    ?? message.from
    ?? message.remoteJid
    ?? message.key?.remoteJid
    ?? ""
  ).trim();
  if (!raw || /@(newsletter|g\.us)$/i.test(raw) || message.fromMe === true || message.key?.fromMe === true) return "";
  return cleanPhone(raw);
}

export async function getGatewaySecrets() {
  const reg = await readRegistry();
  const map = new Map();
  for (const g of reg.gateways) {
    // Secrets are stored under a separate KV key so normal gateway records
    // returned to the UI never contain the secret.
    const store = kv();
    if (store) {
      const secret = await store.get(`${GATEWAY_KV_KEY}:secret:${g.id}`);
      if (secret) map.set(g.id, secret);
    }
  }
  const main = envMainGateway();
  if (main?.bridgeSecret) map.set(main.id, main.bridgeSecret);
  return map;
}

async function getSecretForGateway(gateway) {
  const store = kv();
  if (store) {
    const secret = await store.get(`${GATEWAY_KV_KEY}:secret:${gateway.id}`);
    if (secret) return secret;
  }
  const main = envMainGateway();
  if (main && gateway.id === main.id) return main.bridgeSecret || "";
  return "";
}

export async function upsertGateway(input, {secretProvided=false} = {}) {
  const reg = await readRegistry();
  const gateways = [...reg.gateways];
  const now = new Date().toISOString();
  const id = String(input.id || `gateway-${String(input.adminUsername || input.adminEmail || "admin").toLowerCase().replace(/[^a-z0-9_-]+/g,"-")}`);
  const existing = gateways.find(g => g.id === id);
  const gateway = normalizeGateway({
    ...existing,
    ...input,
    id,
    updatedAt:now,
    createdAt:existing?.createdAt || now,
    secretConfigured: existing?.secretConfigured || secretProvided
  });
  if (!gateway) throw new Error("Data gateway tidak valid.");
  const next = gateways.filter(g => g.id !== id);
  next.push(gateway);
  await writeRegistry(next);
  if (secretProvided) {
    const store = kv();
    if (!store) throw new Error("STORE_KV binding tidak tersedia untuk menyimpan secret gateway.");
    await store.put(`${GATEWAY_KV_KEY}:secret:${id}`, String(input.bridgeSecret || ""));
  }
  return gateway;
}

export async function removeGateway(id) {
  const reg = await readRegistry();
  const next = reg.gateways.filter(g => g.id !== String(id));
  await writeRegistry(next);
  const store = kv();
  if (store) await store.delete(`${GATEWAY_KV_KEY}:secret:${id}`);
  return next;
}

function assertGateway(gateway) {
  if (!gateway) throw new Error("Gateway WhatsApp belum dikonfigurasi.");
  if (!gateway.bridgeUrl) throw new Error(`Bridge URL untuk ${gateway.botName} belum dikonfigurasi.`);
  if (!gateway.botId) throw new Error(`BOT ID untuk ${gateway.botName} belum dikonfigurasi.`);
}

export async function gatewayFetch(gateway, path, options={}) {
  assertGateway(gateway);
  const secret = await getSecretForGateway(gateway);
  if (!secret) throw new Error(`Secret bridge untuk ${gateway.botName} belum dikonfigurasi.`);
  const headers = new Headers(options.headers || {});
  headers.set("Authorization", `Bearer ${secret}`);
  headers.set("X-Bot-ID", gateway.botId);
  headers.set("Accept", "application/json");
  let body = options.body;
  if (body && typeof body !== "string") {
    headers.set("Content-Type","application/json");
    body = JSON.stringify(body);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(`${gateway.bridgeUrl}${path}`, {...options, body, headers, signal:controller.signal});
    const raw = await response.text().catch(() => "");
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch { data = {raw:raw.slice(0,1000)}; }
    if (!response.ok) {
      const error = new Error(data?.message || `Bridge HTTP ${response.status}`);
      error.bridge = {status:response.status,response:data,botIdSent:gateway.botId,url:`${gateway.bridgeUrl}${path}`};
      throw error;
    }
    return data;
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("Request ke bridge timeout.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function sendGatewayText(gateway, to, text) {
  return gatewayFetch(gateway, "/send", {method:"POST", body:{to:cleanPhone(to), text:String(text || "")}});
}

export function buildVerificationConfirmation(user) {
  return `Verifikasi akun berhasil!\n\nBerikut adalah data kamu:\n\n- Email: ${user?.email || "-"}\n- Username: ${user?.username || "-"}\n- Role: User`;
}

export async function sendVerificationConfirmation(gateway, phone, user) {
  const target = cleanPhone(phone);
  if (!gateway || !target) return { skipped:true };
  return sendGatewayText(gateway, target, buildVerificationConfirmation(user));
}

export async function sendGatewayImage(gateway, to, imageUrl, caption="") {
  return gatewayFetch(gateway, "/send-image", {
    method:"POST",
    body:{to:cleanPhone(to), imageUrl:String(imageUrl || ""), caption:String(caption || "")}
  });
}

function itemDetails(items=[]) {
  return items.map(item => {
    const forms = item.parameters && typeof item.parameters === "object"
      ? Object.entries(item.parameters).filter(([,v]) => String(v || "").trim()).map(([k,v]) => `[${String(k).toUpperCase()}] ${v}`).join(", ")
      : "";
    const options = Array.isArray(item.options) && item.options.length ? item.options.join(", ") : "";
    return {
      productName:item.productName || "-",
      productId:item.id || "-",
      forms,
      options
    };
  });
}

export function buildOrderNotification(pending) {
  const details = itemDetails(pending?.items || []);
  const formLines = details.map(x => x.forms ? `Form yang di isi: ${x.forms}` : `Form yang di isi: -`).join("\n");
  const optionLines = details.map(x => x.options ? `Opsi: [PARAMETER], ${x.options}` : `Opsi: -`).join("\n");
  const products = details.map(x => `· Nama Produk: ${x.productName}\n· ID Produk: ${x.productId}`).join("\n");
  return `– PESANAN BARU

${products}
· Metode Pembayaran: ${pending?.paymentMethod || "-"}

${formLines}
${optionLines}

_Silahkan cek web admin panel untuk konfirmasi pesanan..._`;
}

export async function notifyAllGatewaysNewOrder(pending) {
  const gateways = (await getGateways()).filter(g => g.enabled !== false && g.ownerPhone && g.bridgeUrl && g.botId);
  const results = [];
  const caption = buildOrderNotification(pending);
  for (const gateway of gateways) {
    try {
      const result = await sendGatewayImage(gateway, gateway.ownerPhone, pending.proofUrl, caption);
      results.push({gatewayId:gateway.id,success:true,result});
    } catch (error) {
      results.push({gatewayId:gateway.id,success:false,error:error?.message || "Gagal mengirim"});
    }
  }
  return results;
}

export function buildApprovalNotification(purchaseId, admin) {
  return `Pesanan berhasil dikonfirmasi

Order ID: #${purchaseId}

Pesanan telah dikonfirmasi oleh:

Username: ${admin?.username || "-"}
Email: ${admin?.email || "-"}

Status pesanan telah diubah menjadi ACC.`;
}

export { cleanPhone };
