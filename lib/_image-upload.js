export const IMAGE_UPLOAD_ENDPOINT = "https://api.imgbb.com/1/upload";
export const IMAGE_UPLOAD_KEYS = [
  "9d09a9a27a50dbba5445f74ccce939dd",
  "85cbc45884743a344f5d591e8aced8ad"
];
export const CLOUDINARY_ENV = { name:"DINARY_NAME", api:"DINARY_API", secret:"DINARY_SECRET", url:"CLOUDINARY_URL", preset:"DINARY_UPLOAD_PRESET" };

const ALLOWED_IMAGE_HOSTS = new Set(["i.ibb.co","ibb.co","www.ibb.co","res.cloudinary.com","cloudinary.com"]);

export function isValidUploadedImageUrl(value) {
  const raw=String(value||"").trim(); if(!raw)return false;
  try{const url=new URL(raw); return url.protocol==="https:" && (ALLOWED_IMAGE_HOSTS.has(url.hostname.toLowerCase()) || url.hostname.toLowerCase().endsWith(".cloudinary.com"));}catch{return false;}
}
export function extractUploadedImageUrl(data) {
  const candidates=[data?.secure_url,data?.data?.secure_url,data?.data?.url,data?.data?.image?.url,data?.data?.display_url,data?.data?.url,data?.data?.medium?.url,data?.data?.thumb?.url,data?.url];
  for(const c of candidates)if(isValidUploadedImageUrl(c))return String(c).trim();
  return "";
}
