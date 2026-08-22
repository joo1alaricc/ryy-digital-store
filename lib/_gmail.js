import { env } from "./_env.js";

function base64UrlEncode(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function createRawEmail(to, subject, html) {
  const message = [
    `From: RYY STORE <${env("GMAIL_USER")}>`,
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=UTF-8",
    "",
    html
  ].join("\r\n");
  return base64UrlEncode(message);
}

async function accessToken() {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env("GMAIL_CLIENT_ID"),
      client_secret: env("GMAIL_CLIENT_SECRET"),
      refresh_token: env("GMAIL_REFRESH_TOKEN"),
      grant_type: "refresh_token"
    })
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) throw new Error(data.error_description || "Gmail OAuth token gagal.");
  return data.access_token;
}

export async function sendEmail({ to, subject, html }) {
  if (!env("GMAIL_USER") || !env("GMAIL_CLIENT_ID") || !env("GMAIL_CLIENT_SECRET") || !env("GMAIL_REFRESH_TOKEN")) {
    throw new Error("Konfigurasi Gmail belum lengkap.");
  }
  const token = await accessToken();
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ raw: createRawEmail(to, subject, html) })
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gmail API ${response.status}: ${text.slice(0, 500)}`);
  }
  return response.json();
}
