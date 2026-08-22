// Centralized ImgBB image-upload configuration.
// The user explicitly requested these public ImgBB keys to be used.
export const IMAGE_UPLOAD_ENDPOINT = "https://api.imgbb.com/1/upload";
export const IMAGE_UPLOAD_KEYS = [
  "9d09a9a27a50dbba5445f74ccce939dd",
  "85cbc45884743a344f5d591e8aced8ad"
];

const ALLOWED_IMAGE_HOSTS = new Set([
  "i.ibb.co",
  "ibb.co",
  "www.ibb.co"
]);

export function isValidUploadedImageUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return false;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && ALLOWED_IMAGE_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function extractUploadedImageUrl(data) {
  const candidates = [
    data?.data?.image?.url,
    data?.data?.display_url,
    data?.data?.url,
    data?.data?.medium?.url,
    data?.data?.thumb?.url,
    data?.url
  ];
  for (const candidate of candidates) {
    if (isValidUploadedImageUrl(candidate)) return String(candidate).trim();
  }
  return "";
}
