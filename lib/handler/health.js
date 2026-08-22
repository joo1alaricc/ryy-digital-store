export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ success:false, message:"Method tidak diizinkan." });
  return res.status(200).json({
    success: true,
    service: "RYY STORE API",
    runtime: "Cloudflare Pages Worker",
    time: new Date().toISOString()
  });
}
