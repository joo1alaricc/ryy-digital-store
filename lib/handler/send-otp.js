import { generateOTP, createOTPToken } from "../_auth.js";
import { sendEmail } from "../_gmail.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ success: false, message: "Method tidak diizinkan." });
  try {
    const { email } = req.body || {};
    if (!email || !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) return res.status(400).json({ success: false, message: "Format email tidak valid." });
    const otp = generateOTP();
    await sendEmail({
      to: email,
      subject: "Kode OTP RYY STORE",
      html: `<div style="font-family:Arial,sans-serif"><h2>RYY STORE</h2><p>Kode OTP kamu:</p><h1>${otp}</h1><p>Kode ini berlaku selama 5 menit.</p><p>Jangan bagikan kode ini kepada siapa pun.</p></div>`
    });
    return res.status(200).json({ success: true, message: "OTP berhasil dikirim.", otpToken: await createOTPToken(email, otp) });
  } catch (error) {
    console.error("Send OTP error:", error);
    return res.status(500).json({ success: false, message: "Gagal mengirim OTP." });
  }
}
