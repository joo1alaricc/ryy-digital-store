import { env } from "../_env.js";
export default function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ success: false, message: "Method tidak diizinkan." });
  const clientId = env("GOOGLE_CLIENT_ID");
  if (!clientId) return res.status(500).json({ success: false, message: "GOOGLE_CLIENT_ID belum diset di Environment Variables." });
  return res.status(200).json({ success: true, clientId });
}
