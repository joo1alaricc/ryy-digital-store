import { securityTokenFromRequest, verifySecurityToken } from "../_security.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ success: false, message: "Method tidak diizinkan." });
  const token = securityTokenFromRequest(req);
  const valid = Boolean(token && verifySecurityToken(token, req));
  res.setHeader("Cache-Control", "no-store");
  return res.status(valid ? 200 : 403).json(valid ? { success: true, verified: true } : { success: false, verified: false, code: "SECURITY_VERIFICATION_REQUIRED", message: "Sesi keamanan tidak valid." });
}
