const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

import { env } from "./_env.js";

export function getTurnstileSiteKey() {
  return env("TURNSTILE_SITE_KEY", "").trim();
}

export async function verifyTurnstile(token, req) {
  const secret = env("TURNSTILE_SECRET_KEY", "").trim();
  if (!secret) return { success: false, configured: false, message: "Cloudflare Turnstile belum dikonfigurasi di environment." };
  const responseToken = String(token || "").trim();
  if (!responseToken) return { success: false, configured: true, message: "Verifikasi Cloudflare Turnstile wajib dilakukan." };

  try {
    const form = new URLSearchParams();
    form.set("secret", secret);
    form.set("response", responseToken);
    const ip = String(req?.headers?.["cf-connecting-ip"] || req?.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
    if (ip) form.set("remoteip", ip);
    const result = await fetch(VERIFY_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString() });
    const data = await result.json().catch(() => ({}));
    return { success: data?.success === true, configured: true, errors: Array.isArray(data?.["error-codes"]) ? data["error-codes"] : [], message: data?.success === true ? "ok" : "Verifikasi Cloudflare Turnstile gagal." };
  } catch (error) {
    console.error("Turnstile verification error:", error);
    return { success: false, configured: true, message: "Gagal menghubungi verifikasi Cloudflare Turnstile." };
  }
}
