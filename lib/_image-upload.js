// Centralized image-upload configuration and validation.
// Image uploads use Qu.ax. Legacy upload providers are intentionally rejected.

export const IMAGE_UPLOAD_ENDPOINT = "https://qu.ax/upload.php";

const ALLOWED_IMAGE_HOSTS = new Set([
  "qu.ax"
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
    data?.files?.[0]?.url,
    data?.files?.find?.((file) => file?.url)?.url,
    data?.result?.url,
    data?.result?.image?.url,
    data?.data?.url,
    data?.data?.image?.url,
    data?.url,
    data?.image?.url
  ];

  for (const candidate of candidates) {
    if (isValidUploadedImageUrl(candidate)) return String(candidate).trim();
  }

  return "";
}
