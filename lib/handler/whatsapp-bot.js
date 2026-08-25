import { env } from "../_env.js";
import { verifyAdminToken } from "../_admin.js";

function admin(req) {
  const token = String(req.headers?.authorization || "").replace(/^Bearer\s+/i, "");
  return verifyAdminToken(token);
}
function bridgeConfig() {
  const url = env("BOT_BRIDGE_URL").replace(/\/$/, "");
  const secret = env("BOT_BRIDGE_SECRET");
  const id = env("BOT_ID", "ryy-wa-01");
  if (!url && !secret) throw new Error("BOT_BRIDGE_URL dan BOT_BRIDGE_SECRET belum dikonfigurasi di Cloudflare Pages.");
  if (!url) throw new Error("BOT_BRIDGE_URL belum dikonfigurasi di Cloudflare Pages.");
  if (!secret) throw new Error("BOT_BRIDGE_SECRET belum dikonfigurasi di Cloudflare Pages.");
  return { url, secret, id };
}
async function bridgeFetch(path, options = {}) {
  const cfg = bridgeConfig();
  const headers = new Headers(options.headers || {});
  headers.set("Authorization", `Bearer ${cfg.secret}`);
  headers.set("X-Bot-ID", cfg.id);
  headers.set("Accept", "application/json");
  if (options.body && typeof options.body !== "string") {
    headers.set("Content-Type", "application/json");
    options.body = JSON.stringify(options.body);
  }
  const r = await fetch(`${cfg.url}${path}`, { ...options, headers });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.message || `Bot bridge HTTP ${r.status}`);
  return data;
}

export default async function handler(req, res) {
  if (!admin(req)) return res.status(401).json({ success: false, message: "Sesi admin tidak valid." });
  try {
    const method = String(req.method || "GET").toUpperCase();
    const action = String(req.body?.action || req.query?.action || "status");
    if (method === "GET" || action === "status") return res.status(200).json(await bridgeFetch("/status"));
    if (method !== "POST") return res.status(405).json({ success: false, message: "Method tidak diizinkan." });
    if (action === "pair") {
      const phone = String(req.body?.phone || "").replace(/\D/g, "");
      if (!phone) return res.status(400).json({ success: false, message: "Nomor WhatsApp wajib diisi." });
      return res.status(200).json(await bridgeFetch("/pair", { method: "POST", body: { phone } }));
    }
    if (action === "send") return res.status(200).json(await bridgeFetch("/send", { method: "POST", body: { to: req.body?.to, text: req.body?.text } }));
    if (action === "disconnect") return res.status(200).json(await bridgeFetch("/disconnect", { method: "POST", body: {} }));
    if (action === "restart") return res.status(200).json(await bridgeFetch("/restart", { method: "POST", body: {} }));
    return res.status(400).json({ success: false, message: "Action bot tidak dikenal." });
  } catch (error) {
    console.error("WhatsApp bot bridge error:", error);
    return res.status(502).json({ success: false, message: error?.message || "Bot WhatsApp tidak dapat dihubungi." });
  }
}
