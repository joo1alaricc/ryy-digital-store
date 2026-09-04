import { issueSecurityChallenge, rateLimit } from "../_security.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ success: false, message: "Method tidak diizinkan." });
  try {
    const limit = await rateLimit(req, "challenge", 12, 600);
    if (!limit.allowed) {
      res.setHeader("Retry-After", String(limit.retryAfter || 60));
      return res.status(429).json({ success: false, message: "Terlalu banyak permintaan verifikasi. Coba lagi sebentar." });
    }
    const data = await issueSecurityChallenge(req);
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(data);
  } catch (error) {
    console.error("Security challenge error:", error);
    return res.status(503).json({ success: false, message: error?.message || "Verifikasi keamanan belum tersedia." });
  }
}
