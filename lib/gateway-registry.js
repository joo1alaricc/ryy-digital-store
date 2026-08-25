import { env } from "./_env.js";

const PRIMARY_USERNAME = "admin_utama";
const PRIMARY_EMAIL = "admin1@store.com";

function normalizeGateway(raw, index=0) {
  if (!raw || typeof raw !== "object") return null;
  const adminUsername = String(raw.adminUsername || raw.username || "").trim();
  const adminEmail = String(raw.adminEmail || raw.email || "").trim().toLowerCase();
  const id = String(raw.id || raw.gatewayId || raw.botId || `gateway-${index+1}`).trim();
  const bridgeUrl = String(raw.bridgeUrl || raw.url || "").trim().replace(/\/$/, "");
  const botId = String(raw.botId || raw.id || "").trim();
  const secret = String(raw.secret || raw.bridgeSecret || "");
  const ownerPhone = String(raw.ownerPhone || raw.owner || "").replace(/\D/g, "");
  if (!id || !bridgeUrl || !botId || !secret) return null;
  return {
    id, adminUsername, adminEmail, bridgeUrl, botId, secret, ownerPhone,
    botName: String(raw.botName || raw.name || botId),
    profileName: String(raw.profileName || raw.botName || botId),
    enabled: raw.enabled !== false
  };
}

export function getGateways() {
  try {
    const raw = env("BOT_GATEWAYS");
    if (raw) {
      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed) ? parsed : parsed.gateways;
      if (Array.isArray(list)) return list.map(normalizeGateway).filter(Boolean);
    }
  } catch {}
  const legacy = normalizeGateway({
    id: env("BOT_ID", "ryy-wa-01"),
    botId: env("BOT_ID", "ryy-wa-01"),
    bridgeUrl: env("BOT_BRIDGE_URL"),
    secret: env("BOT_BRIDGE_SECRET"),
    ownerPhone: env("BOT_OWNER_PHONE"),
    adminUsername: PRIMARY_USERNAME,
    adminEmail: PRIMARY_EMAIL,
    botName: env("BOT_NAME", "RYY Main Bot")
  });
  return legacy ? [legacy] : [];
}

export function isPrimaryAdmin(admin) {
  const username = String(admin?.username || "").trim().toLowerCase();
  const email = String(admin?.email || "").trim().toLowerCase();
  return username === PRIMARY_USERNAME || email === PRIMARY_EMAIL ||
    String(admin?.role || "").toLowerCase() === "superadmin" ||
    String(admin?.role || "").toLowerCase() === "super";
}

export function gatewayForAdmin(admin) {
  const username = String(admin?.username || "").toLowerCase();
  const email = String(admin?.email || "").toLowerCase();
  const all = getGateways().filter(g => g.enabled);
  return all.find(g => String(g.adminUsername).toLowerCase() === username || (email && String(g.adminEmail).toLowerCase() === email))
    || (isPrimaryAdmin(admin) ? all.find(g => String(g.adminUsername).toLowerCase() === PRIMARY_USERNAME || String(g.adminEmail).toLowerCase() === PRIMARY_EMAIL) : null);
}

export function primaryGateway() {
  return gatewayForAdmin({username: PRIMARY_USERNAME, email: PRIMARY_EMAIL, role: "superadmin"});
}

export async function gatewayFetch(gateway, path, options={}) {
  if (!gateway) throw new Error("Gateway bot tidak ditemukan.");
  const headers = new Headers(options.headers || {});
  headers.set("Authorization", `Bearer ${gateway.secret}`);
  headers.set("X-Bot-ID", gateway.botId);
  headers.set("Accept", "application/json");
  let body = options.body;
  if (body && typeof body !== "string") { headers.set("Content-Type", "application/json"); body = JSON.stringify(body); }
  const response = await fetch(`${gateway.bridgeUrl}${path}`, {...options, body, headers});
  const raw = await response.text().catch(()=> "");
  let data={}; try { data=raw?JSON.parse(raw):{}; } catch { data={raw}; }
  if (!response.ok) throw new Error(data?.message || `Gateway HTTP ${response.status}`);
  return data;
}

export async function notifyPrimaryApproval({purchaseId, admin}) {
  const g = primaryGateway();
  const text = `– PESANAN DI-ACC\n\n· ID Pesanan: ${purchaseId}\n· Dikonfirmasi oleh: ${admin.username} (${admin.email || "-"})\n\n_Silahkan cek web admin panel untuk detail pesanan._`;
  if (g?.ownerPhone) await gatewayFetch(g, "/send", {method:"POST", body:{to:g.ownerPhone,text}});
}

export async function notifyAllNewOrder({purchase, user}) {
  const gateways=getGateways().filter(g=>g.enabled && g.ownerPhone);
  const items=(purchase.items||[]).map((item, index)=>{
    const forms=Object.entries(item.parameters||{}).map(([k,v])=>`· Form yang diisi: [${k.toUpperCase()}] ${v}`).join("\n");
    const options=(item.options||[]).length?`· Opsi: [PARAMETER], ${(item.options||[]).join(", ")}`:"";
    return [`${index? "\n":""}· Nama Produk: ${item.productName}`,`· ID Produk: ${item.id}`,`· Metode Pembayaran: ${purchase.paymentMethod}`,forms,options].filter(Boolean).join("\n");
  }).join("\n");
  const caption=`– PESANAN BARU\n${items}\n\n_Silahkan cek web admin panel untuk konfirmasi pesanan..._`;
  return Promise.allSettled(gateways.map(g=>gatewayFetch(g,"/send-image",{method:"POST",body:{to:g.ownerPhone,imageUrl:purchase.proofUrl,caption}})));
}
export async function notifyAdminOrderImage({admin, purchaseId, imageUrl, caption}) {
  const g=gatewayForAdmin(admin);
  if(!g?.ownerPhone) return null;
  return gatewayFetch(g,"/send-image",{method:"POST",body:{to:g.ownerPhone,imageUrl,caption:caption||`– BUKTI LOGIN USER\n· ID Pesanan: ${purchaseId}`}}); 
}
