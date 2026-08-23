export const IMAGE_UPLOAD_ENDPOINT = "https://cloud.yardansh.com/upload";
export const IMAGE_UPLOAD_HOST = "cloud.yardansh.com";

export function isValidUploadedImageUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return false;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && url.hostname.toLowerCase() === IMAGE_UPLOAD_HOST;
  } catch {
    return false;
  }
}

export function extractUploadedImageUrl(data) {
  const candidates = [
    data?.url,
    data?.data?.url,
    data?.secure_url,
    data?.data?.secure_url,
    data?.file?.url
  ];
  for (const candidate of candidates) {
    if (isValidUploadedImageUrl(candidate)) return String(candidate).trim();
  }
  return "";
}
