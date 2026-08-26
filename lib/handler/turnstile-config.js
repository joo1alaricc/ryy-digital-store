import { getTurnstileSiteKey } from "../_turnstile.js";
export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ success:false, message:"Method tidak diizinkan." });
  const siteKey = getTurnstileSiteKey();
  return res.status(200).json({ success:true, enabled:Boolean(siteKey), siteKey });
}
