import { verifySecurityChallenge, rateLimit } from "../_security.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ success: false, message: "Method tidak diizinkan." });
  try {
    const limit = await rateLimit(req, "verify", 24, 600);
    if (!limit.allowed) {
      res.setHeader("Retry-After", String(limit.retryAfter || 60));
      return res.status(429).json({ success: false, message: "Terlalu banyak percobaan verifikasi. Coba lagi sebentar." });
    }
    const data = await verifySecurityChallenge(req, req.body?.challengeId, req.body?.nonce, req.body?.counter, req.body?.elapsedMs);
    return res.status(data.status || (data.success ? 200 : 400)).json(data);
  } catch (error) {
    console.error("Security verify error:", error);
    return res.status(500).json({ success: false, message: "Verifikasi keamanan gagal." });
  }
}
