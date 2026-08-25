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

  if (!url) throw new Error("BOT_BRIDGE_URL belum dikonfigurasi di Cloudflare.");
  if (!secret) throw new Error("BOT_BRIDGE_SECRET belum dikonfigurasi di Cloudflare.");
  if (!id) throw new Error("BOT_ID belum dikonfigurasi di Cloudflare.");

  return { url, secret, id };
}

async function bridgeFetch(path, options = {}) {
  const cfg = bridgeConfig();
  const headers = new Headers(options.headers || {});
  headers.set("Authorization", `Bearer ${cfg.secret}`);
  headers.set("X-Bot-ID", cfg.id);
  headers.set("Accept", "application/json");

  let body = options.body;
  if (body && typeof body !== "string") {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(`${cfg.url}${path}`, {
      ...options,
      body,
      headers
    });
  } catch (error) {
    throw new Error(`Bridge tidak dapat diakses: ${error?.message || "network error"}`);
  }

  const raw = await response.text().catch(() => "");
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw }; }

  if (!response.ok) {
    const reason = data?.reason ? ` (${data.reason})` : "";
    const message = data?.message || `Bot bridge HTTP ${response.status}`;
    const error = new Error(`${message}${reason}`);
    error.bridge = {
      status: response.status,
      ok: false,
      url: `${cfg.url}${path}`,
      botIdSent: cfg.id,
      authorizationSent: true,
      response: data
    };
    throw error;
  }
  return data;
}

async function diagnoseBridge() {
  const cfg = bridgeConfig();
  const result = {
    success: false,
    bridgeUrl: cfg.url,
    botIdConfigured: Boolean(cfg.id),
    botIdSent: cfg.id,
    secretConfigured: Boolean(cfg.secret),
    authorizationSent: true,
    botIdHeaderSent: true,
    health: null,
    authenticatedRequest: null
  };

  // Public health: proves URL/network/port without exposing the secret.
  try {
    const response = await fetch(`${cfg.url}/health`, {
      method: "GET",
      headers: { Accept: "application/json" }
    });
    const raw = await response.text().catch(() => "");
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw: raw.slice(0, 500) }; }
    result.health = {
      ok: response.ok,
      status: response.status,
      response: data
    };
  } catch (error) {
    result.health = {
      ok: false,
      status: 0,
      error: error?.message || "network error"
    };
    result.message = "Bridge URL tidak dapat diakses dari Cloudflare Worker.";
    return result;
  }

  // Authenticated request: deliberately return upstream status/body so admin
  // can distinguish wrong secret, wrong bot ID, missing headers, etc.
  try {
    const response = await fetch(`${cfg.url}/status`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${cfg.secret}`,
        "X-Bot-ID": cfg.id,
        Accept: "application/json"
      }
    });
    const raw = await response.text().catch(() => "");
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw: raw.slice(0, 500) }; }

    result.authenticatedRequest = {
      ok: response.ok,
      status: response.status,
      response: data
    };
    result.success = response.ok;
    result.message = response.ok
      ? "Autentikasi bridge berhasil."
      : (data?.message || `Bridge menolak request (HTTP ${response.status}).`);
  } catch (error) {
    result.authenticatedRequest = {
      ok: false,
      status: 0,
      error: error?.message || "network error"
    };
    result.message = "Request authenticated ke bridge gagal.";
  }

  return result;
}

export default async function handler(req, res) {
  if (!admin(req)) {
    return res.status(401).json({ success: false, message: "Sesi admin tidak valid." });
  }

  try {
    const method = String(req.method || "GET").toUpperCase();
    const action = String(req.body?.action || req.query?.action || "status");

    if (action === "diagnose") {
      return res.status(200).json(await diagnoseBridge());
    }

    if (method === "GET" && action === "health") {
      // Health is public on the bridge, but is requested here so the admin
      // panel can diagnose network reachability without exposing the secret.
      const cfg = bridgeConfig();
      let response;
      try {
        response = await fetch(`${cfg.url}/health`, {
          method: "GET",
          headers: { Accept: "application/json" }
        });
      } catch (error) {
        throw new Error(`Bridge tidak dapat diakses: ${error?.message || "network error"}`);
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.message || `Health HTTP ${response.status}`);
      }
      return res.status(200).json(data);
    }

    if (method === "GET" || action === "status") {
      return res.status(200).json(await bridgeFetch("/status"));
    }

    if (method !== "POST") {
      return res.status(405).json({ success: false, message: "Method tidak diizinkan." });
    }

    if (action === "pair") {
      const phone = String(req.body?.phone || "").replace(/\D/g, "");
      if (!phone) {
        return res.status(400).json({ success: false, message: "Nomor WhatsApp wajib diisi." });
      }
      return res.status(200).json(await bridgeFetch("/pair", {
        method: "POST",
        body: { phone }
      }));
    }

    if (action === "send") {
      return res.status(200).json(await bridgeFetch("/send", {
        method: "POST",
        body: { to: req.body?.to, text: req.body?.text }
      }));
    }

    if (action === "disconnect") {
      return res.status(200).json(await bridgeFetch("/disconnect", {
        method: "POST",
        body: {}
      }));
    }

    if (action === "restart") {
      return res.status(200).json(await bridgeFetch("/restart", {
        method: "POST",
        body: {}
      }));
    }

    return res.status(400).json({ success: false, message: "Action bot tidak dikenal." });
  } catch (error) {
    console.error("WhatsApp bot bridge error:", error);
    return res.status(502).json({
      success: false,
      message: error?.message || "Bot WhatsApp tidak dapat dihubungi."
    });
  }
}
