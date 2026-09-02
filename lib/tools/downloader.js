import { registerOtherTool } from "./registry.js";

registerOtherTool({
  id: "video-downloader",
  name: "Downloader video all platform",
  description: "Download video/audio dari berbagai platform.",
  defaultEnabled: true
});

const API = "https://api.azbry.com/api/download/allinonev2";

function cleanUrl(value) {
  try {
    const u = new URL(String(value || ""));
    if (!/^https?:$/.test(u.protocol)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

function normalizeMedia(item, index) {
  const url = item?.url || "";
  const label = String(item?.label || `Download ${index + 1}`);
  const audio = /mp3|audio/i.test(label) || /\.mp3(?:$|\?)/i.test(url);
  const sizeMatch = label.match(/(\d{3,5})x(\d{3,5})p/i);
  return {
    url,
    label,
    type: audio ? "audio" : "video",
    extension: audio ? "mp3" : "mp4",
    quality: sizeMatch ? `${sizeMatch[1]}x${sizeMatch[2]}p` : (audio ? "MP3" : "Video"),
    width: sizeMatch ? Number(sizeMatch[1]) : 0,
    height: sizeMatch ? Number(sizeMatch[2]) : 0,
    data_size: 0,
    duration: 0
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ success: false, message: "Method tidak diizinkan." });
  const target = cleanUrl(req.query?.url);
  if (!target) return res.status(400).json({ success: false, message: "Link video tidak valid." });

  try {
    const upstream = await fetch(`${API}?url=${encodeURIComponent(target)}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "RYY-Store-Downloader/1.0"
      }
    });
    const data = await upstream.json().catch(() => null);
    if (!upstream.ok || !data?.status || !data?.result) {
      return res.status(upstream.status || 502).json({
        success: false,
        message: data?.message || "Video tidak dapat diproses."
      });
    }

    const result = data.result || {};
    const downloads = Array.isArray(result.downloads) ? result.downloads : [];
    const medias = downloads.filter(x => x?.url).map(normalizeMedia);

    return res.status(200).json({
      success: true,
      author: data.creator || "",
      result: {
        title: result.title || "",
        owner: result.owner || null,
        thumbnail: result.thumbnail || "",
        downloads,
        medias
      }
    });
  } catch (e) {
    console.error("Downloader API error", e);
    return res.status(502).json({ success: false, message: "Gagal menghubungi downloader API." });
  }
}
