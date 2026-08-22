import { verifyOTPToken } from "../_auth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, message: "Method tidak diizinkan." });
  }

  try {
    const { email: rawEmail, otp, otpToken } = req.body || {};
    const email = String(rawEmail || "").trim().toLowerCase();
    const code = String(otp || "").trim();

    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).json({ success: false, message: "Format email tidak valid." });
    }
    if (!/^\d{4}$/.test(code) || !otpToken) {
      return res.status(400).json({ success: false, message: "OTP tidak lengkap." });
    }

    const verified = verifyOTPToken(otpToken, email, code);
    if (!verified) {
      return res.status(400).json({ success: false, verified: false, message: "OTP salah atau sudah kedaluwarsa." });
    }

    return res.status(200).json({ success: true, verified: true, message: "OTP berhasil diverifikasi." });
  } catch (error) {
    console.error("Verify OTP error:", error);
    return res.status(500).json({ success: false, verified: false, message: "Gagal memverifikasi OTP." });
  }
}
