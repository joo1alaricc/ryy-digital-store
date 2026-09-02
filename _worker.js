import legacyHandler from "./lib/_api-router.js";
import inboxCleanup from "./lib/handler/inbox-cleanup.js";
import subscriptionReminders from "./lib/handler/subscription-reminders.js";
import { setRuntimeEnv, hydrateRuntimeEnv } from "./lib/_env.js";

function makeReq(request) {
  const url = new URL(request.url);
  const headers = {};
  request.headers.forEach((v, k) => { headers[k] = v; });
  const query = {};
  url.searchParams.forEach((v, k) => { query[k] = v; });
  return { method: request.method, headers, query, url: request.url, body: undefined, bodyUsed: false };
}

function makeRes() {
  let statusCode = 200;
  const headers = new Headers();
  let payload = "";
  let sent = false;
  return {
    get headersSent() { return sent; },
    status(code) { statusCode = code; return this; },
    setHeader(name, value) { headers.set(name, Array.isArray(value) ? value.join(", ") : String(value)); return this; },
    json(data) { payload = JSON.stringify(data); headers.set("content-type", "application/json; charset=utf-8"); sent = true; return this; },
    send(data) { payload = typeof data === "string" ? data : JSON.stringify(data); if (typeof data !== "string") headers.set("content-type", "application/json; charset=utf-8"); sent = true; return this; },
    end(data) { if (data !== undefined) this.send(data); else sent = true; return this; },
    response() { return new Response(payload, { status: statusCode, headers }); }
  };
}

async function dispatch(request, env, targetHandler = legacyHandler) {
  setRuntimeEnv(env);
  await hydrateRuntimeEnv();
  const req = makeReq(request);
  if (!["GET", "HEAD"].includes(request.method)) {
    const type = request.headers.get("content-type") || "";
    if (type.includes("application/json")) {
      try { req.body = await request.json(); } catch { req.body = {}; }
    } else {
      try { req.body = await request.text(); } catch { req.body = undefined; }
    }
  }
  const res = makeRes();
  try {
    await targetHandler(req, res);
    return res.response();
  } catch (error) {
    console.error("RYY STORE request error:", error);
    return Response.json({ success: false, message: "Terjadi kesalahan pada server." }, { status: 500 });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Image proxy for Yardansh CDN. The CDN intentionally blocks browser hotlinking
    // with Cloudflare 1011, so images are fetched server-side and returned from
    // this same Pages origin. Only the approved image host is allowed.
    if (url.pathname === "/api/downloader-download") {
      if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method Not Allowed", {status:405});
      const raw=url.searchParams.get("url")||"";
      let target; try{target=new URL(raw)}catch{return new Response("Invalid media URL",{status:400})}
      const host=target.hostname.toLowerCase();
      const allowed=["tiktokcdn.com","tiktokv.com","tiktok.com","tiktokcdn-us.com","tiktokcdn-eu.com","googlevideo.com","youtube.com","youtu.be","fbcdn.net","instagram.com","cdninstagram.com","pinimg.com"];
      if(target.protocol!=="https:" || !allowed.some(x=>host===x||host.endsWith("."+x))) return new Response("Media host tidak diizinkan",{status:403});
      try{
        const upstream=await fetch(target.toString(),{method:request.method,headers:{"User-Agent":"Mozilla/5.0","Accept":"video/*,audio/*,*/*;q=0.8"},redirect:"follow"});
        if(!upstream.ok) return new Response("Media tidak tersedia",{status:upstream.status});
        const headers=new Headers(upstream.headers); const ct=upstream.headers.get("content-type")||""; headers.set("Content-Disposition",`attachment; filename=ryy-store-media.${ct.includes("audio")?"mp3":"mp4"}`); headers.set("Cache-Control","no-store"); headers.set("X-Content-Type-Options","nosniff");
        return new Response(upstream.body,{status:upstream.status,headers});
      }catch(e){return new Response("Gagal mengambil media",{status:502})}
    }

    if (url.pathname === "/api/image-proxy") {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response("Method Not Allowed", { status: 405, headers: { "Allow": "GET, HEAD" } });
      }
      const raw = url.searchParams.get("url") || "";
      let target;
      try { target = new URL(raw); } catch {
        return Response.json({ success: false, message: "URL gambar tidak valid." }, { status: 400 });
      }
      const allowedImageHosts = new Set(["cloud.yardansh.com","cdn.phototourl.com","upload.shizukuuu.cloud","qu.ax"]);
      if (target.protocol !== "https:" || !allowedImageHosts.has(target.hostname.toLowerCase())) {
        return Response.json({ success: false, message: "Host gambar tidak diizinkan." }, { status: 403 });
      }
      // Force the CDN's raw representation; preserve no user-supplied query params
      // so the proxy cannot be abused to request unrelated resources.
      const originalHost = target.hostname.toLowerCase();
      target.search = "";
      if (originalHost === "cloud.yardansh.com") target.searchParams.set("raw", "");
      try {
        const upstream = await fetch(target.toString(), {
          method: request.method,
          headers: {
            "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
            "User-Agent": "RYY-Store-Image-Proxy/1.0"
          },
          cf: { cacheEverything: true, cacheTtl: 86400 }
        });
        if (!upstream.ok) {
          return new Response("Upstream image unavailable", { status: upstream.status, headers: { "Cache-Control": "no-store" } });
        }
        const headers = new Headers(upstream.headers);
        headers.set("Cache-Control", "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400");
        headers.set("X-Content-Type-Options", "nosniff");
        headers.set("Access-Control-Allow-Origin", url.origin);
        return new Response(upstream.body, { status: upstream.status, headers });
      } catch (error) {
        console.error("Image proxy error:", error);
        return Response.json({ success: false, message: "Gagal mengambil gambar dari CDN." }, { status: 502 });
      }
    }

    if (url.pathname.startsWith("/api/")) {
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": url.origin,
            "Access-Control-Allow-Methods": "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept",
            "Access-Control-Max-Age": "86400"
          }
        });
      }

      const response = await dispatch(request, env);
      const headers = new Headers(response.headers);
      headers.set("Access-Control-Allow-Origin", url.origin);
      headers.set("Access-Control-Allow-Methods", "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS");
      headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept");
      headers.set("Cache-Control", "no-store");
      headers.set("X-RYY-API", "cloudflare-pages-worker");
      return new Response(response.body, { status: response.status, headers });
    }

    // Cloudflare Pages static assets. Keep SPA navigation on index.html.
    if (request.method === "GET" || request.method === "HEAD") {
      const assetResponse = await env.ASSETS.fetch(request);
      if (assetResponse.status !== 404) return assetResponse;
      return env.ASSETS.fetch(new Request(new URL("/", request.url), request));
    }
    return env.ASSETS.fetch(request);
  },

  async scheduled(controller, env, ctx) {
    setRuntimeEnv(env);
    await hydrateRuntimeEnv();
    const cron = controller.cron;
    try {
      // UTC schedules: 00:00 UTC is 07:00 WIB.
      if (cron === "0 0 * * *") {
        const req = { method: "POST", headers: { authorization: `Bearer ${env.CRON_SECRET || ""}` }, query: {}, url: "https://internal/api/inbox-cleanup", body: {}, bodyUsed: false };
        const res = makeRes();
        await inboxCleanup(req, res);
        console.log("Inbox cleanup:", res.response().status);
      }

      // Subscription reminders are intentionally daily at 01:00 UTC (08:00 WIB).
      if (cron === "0 1 * * *") {
        const req = { method: "POST", headers: { authorization: `Bearer ${env.CRON_SECRET || ""}` }, query: {}, url: "https://internal/api/subscription-reminders", body: {}, bodyUsed: false };
        const res = makeRes();
        await subscriptionReminders(req, res);
        console.log("Subscription reminders:", res.response().status);
      }
    } catch (error) {
      console.error("Scheduled job failed:", error);
      controller.noRetry?.();
    }
  }
};
