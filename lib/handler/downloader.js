const AIO_ENDPOINT = "https://api.nexray.eu.cc/downloader/aio";

function validInputUrl(value) {
  try {
    const u = new URL(String(value || "").trim());
    return /^https?:$/.test(u.protocol) ? u.toString() : null;
  } catch { return null; }
}

function allowedMediaHost(hostname) {
  const h = String(hostname || "").toLowerCase();
  const hosts = [
    "tiktokcdn.com", "tiktokv.com", "tiktok.com",
    "youtube.com", "googlevideo.com", "ytimg.com",
    "instagram.com", "cdninstagram.com", "fbcdn.net", "facebook.com",
    "twimg.com", "twitter.com", "x.com",
    "soundcloud.com", "sndcdn.com", "spotifycdn.com"
  ];
  return hosts.some(base => h === base || h.endsWith(`.${base}`));
}

function safeFilename(name, ext = "bin") {
  const clean = String(name || "RYY-Store-Download").replace(/[^a-zA-Z0-9._ -]/g, "").trim().slice(0, 80) || "RYY-Store-Download";
  const normalizedExt = String(ext || "bin").replace(/[^a-zA-Z0-9]/g, "").slice(0, 8) || "bin";
  return `${clean}.${normalizedExt}`;
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ success:false, message:"Method tidak diizinkan." });
  const url = req.query?.url || new URL(req.url).searchParams.get("url") || "";
  const media = req.query?.media || new URL(req.url).searchParams.get("media") || "";

  // Media mode: stream the actual bytes through our Worker so the browser downloads
  // the file rather than navigating to the provider's URL.
  if (media) {
    let target;
    try { target = new URL(media); } catch { return res.status(400).json({ success:false, message:"URL media tidak valid." }); }
    if (!/^https?:$/.test(target.protocol) || !allowedMediaHost(target.hostname)) {
      return res.status(403).json({ success:false, message:"Host media tidak diizinkan." });
    }
    try {
      const upstream = await fetch(target.toString(), { headers:{ "User-Agent":"Mozilla/5.0 RYY-Store Downloader", Accept:"*/*" }, redirect:"follow" });
      if (!upstream.ok) return res.status(upstream.status).json({ success:false, message:`Media provider mengembalikan HTTP ${upstream.status}.` });
      const contentType = upstream.headers.get("content-type") || "application/octet-stream";
      const ext = (new URL(target.toString()).pathname.split(".").pop() || (contentType.includes("audio") ? "mp3" : "mp4")).split("?")[0];
      const requestedName = String(req.query?.filename || "RYY-Store-Download");
      const filename = /\.[a-zA-Z0-9]{2,8}$/.test(requestedName) ? requestedName.replace(/[^a-zA-Z0-9._ -]/g, "").slice(0, 100) : safeFilename(requestedName, ext);
      const inline = String(req.query?.inline || "") === "1";
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Disposition", `attachment; filename="${filename.replace(/"/g, "")}"`);
      res.setHeader("Cache-Control", "no-store");
      // The adapter's send() is string-oriented, so use a direct Response marker.
      // _worker.js handles this special return object.
      return { __streamResponse: new Response(upstream.body, { status:200, headers:{
        "Content-Type": contentType,
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${filename.replace(/"/g, "")}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
      }}) };
    } catch (error) {
      console.error("Downloader media proxy error:", error);
      return res.status(502).json({ success:false, message:"Gagal mengambil file dari provider." });
    }
  }

  const sourceUrl = validInputUrl(url);
  if (!sourceUrl) return res.status(400).json({ success:false, message:"Masukkan link video yang valid." });

  try {
    const endpoint = `${AIO_ENDPOINT}?url=${encodeURIComponent(sourceUrl)}`;
    const upstream = await fetch(endpoint, { headers:{ Accept:"application/json", "User-Agent":"RYY-Store/Downloader" } });
    const text = await upstream.text();
    let data; try { data = JSON.parse(text); } catch { data = null; }
    if (!upstream.ok || !data) return res.status(502).json({ success:false, message:"API downloader tidak memberikan respons yang valid." });
    if (!data.status || !data.result) return res.status(400).json({ success:false, message:data.message || "Video tidak dapat diproses." });
    return res.status(200).json({ success:true, result:data.result, timestamp:data.timestamp || null, response_time:data.response_time || null });
  } catch (error) {
    console.error("Downloader API error:", error);
    return res.status(502).json({ success:false, message:"Gagal menghubungkan ke API downloader." });
  }
}
