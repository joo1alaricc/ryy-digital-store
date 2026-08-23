import { verifyUserToken } from "../_auth.js";
import { IMAGE_UPLOAD_ENDPOINT, extractUploadedImageUrl } from "../_image-upload.js";

const MAX_DATA_URL = 4 * 1024 * 1024;

function auth(req) {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  return verifyUserToken(token);
}

function parseDataUrl(value) {
  const match = String(value || "").match(/^data:([^;,]+)?(?:;[^,]+)*;base64,(.+)$/i);
  if (!match) return null;
  const mime = match[1] || "image/jpeg";
  const base64 = match[2].replace(/\s/g, "");
  if (!/^image\/(?:png|jpe?g|webp|gif)$/i.test(mime)) return null;
  if (!/^[A-Za-z0-9+/=]+$/.test(base64)) return null;
  return { mime, base64 };
}

function extensionForMime(mime) {
  const type = String(mime || "").toLowerCase();
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  if (type === "image/gif") return "gif";
  return "jpg";
}

async function readProviderResponse(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text.slice(0, 500) };
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, message: "Method tidak diizinkan." });
  }

  if (!auth(req)) {
    return res.status(401).json({ success: false, message: "Sesi user tidak valid atau sudah kedaluwarsa." });
  }

  try {
    const image = String(req.body?.image || "").trim();
    const kind = String(req.body?.kind || "image").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "") || "image";

    if (!image) return res.status(400).json({ success: false, message: "Gambar wajib diisi." });
    if (image.length > MAX_DATA_URL) {
      return res.status(413).json({ success: false, message: "Ukuran gambar terlalu besar." });
    }

    const parsed = parseDataUrl(image);
    if (!parsed) {
      return res.status(400).json({ success: false, message: "Format gambar tidak valid. Gunakan JPG, PNG, WEBP, atau GIF." });
    }

    const buffer = Buffer.from(parsed.base64, "base64");
    if (!buffer.length) return res.status(400).json({ success: false, message: "File gambar kosong." });

    const ext = extensionForMime(parsed.mime);
    const filename = `${kind}-${Date.now()}.${ext}`;

    // Yardansh accepts a standard multipart/form-data field named `file`.
    // Do not manually set Content-Type; the runtime adds the multipart boundary.
    const form = new FormData();
    form.append("file", new Blob([buffer], { type: parsed.mime }), filename);

    const response = await fetch(IMAGE_UPLOAD_ENDPOINT, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(30000)
    });

    const data = await readProviderResponse(response);
    const url = extractUploadedImageUrl(data);
    const providerMessage = data?.message || data?.error || data?.detail || "";

    if (!response.ok || !url) {
      console.error("Image upload provider error", {
        endpoint: IMAGE_UPLOAD_ENDPOINT,
        kind,
        status: response.status,
        providerMessage
      });
      return res.status(502).json({
        success: false,
        message: providerMessage || `Upload gambar gagal (HTTP ${response.status}).`
      });
    }

    return res.status(200).json({
      success: true,
      url,
      displayUrl: url,
      viewerUrl: url,
      rawUrl: `${url}?raw`,
      filename,
      originalName: filename,
      size: buffer.length,
      mimeType: parsed.mime
    });
  } catch (error) {
    console.error("Image upload exception:", error);
    return res.status(500).json({
      success: false,
      message: error?.name === "TimeoutError"
        ? "Upload gambar timeout. Silakan coba lagi."
        : "Gagal mengupload gambar ke server upload."
    });
  }
}
