import { env } from "../_env.js";
import { readDatabase, writeDatabase } from "../_github.js";
import { sendEmail } from "../_gmail.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function remainingLabel(ms) {
  const totalMinutes = Math.max(1, Math.floor(ms / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts = [];
  if (days) parts.push(`${days} hari`);
  if (hours || days) parts.push(`${hours} jam`);
  parts.push(`${minutes} menit`);
  return parts.join(", ");
}

function reminderEmail({ user, subscription, remaining, expiresAt }) {
  const product = escapeHtml(subscription.productName || "Produk Premium");
  const type = subscription.typeName ? ` — ${escapeHtml(subscription.typeName)}` : "";
  const username = escapeHtml(user.displayName || user.username || "Pelanggan");
  const expiry = new Date(expiresAt).toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    dateStyle: "full",
    timeStyle: "short"
  });

  return `<!doctype html>
<html><body style="margin:0;background:#0b0d10;color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
  <div style="max-width:620px;margin:0 auto;padding:28px 18px;">
    <div style="background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.16);border-radius:28px;padding:28px;box-shadow:0 20px 60px rgba(0,0,0,.25);">
      <div style="font-size:13px;letter-spacing:.12em;color:#8ee7dc;font-weight:700;">RYY STORE</div>
      <h1 style="font-size:26px;margin:10px 0 8px;">Langganan kamu hampir habis</h1>
      <p style="color:#b9bdc7;line-height:1.6;margin:0 0 22px;">Hai ${username}, salah satu langganan premium kamu akan segera berakhir. Pastikan kamu memperpanjangnya sebelum akses berakhir.</p>
      <div style="background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.13);border-radius:20px;padding:18px;margin-bottom:18px;">
        <div style="font-size:14px;color:#aeb4bf;">Produk</div>
        <div style="font-size:19px;font-weight:700;margin-top:5px;">${product}${type}</div>
        <div style="font-size:15px;color:#75e3d6;font-weight:700;margin-top:14px;">Sisa waktu: ${escapeHtml(remaining)}</div>
        <div style="font-size:13px;color:#aeb4bf;margin-top:6px;">Berakhir: ${escapeHtml(expiry)} WIB</div>
      </div>
      <p style="font-size:13px;color:#8f95a1;line-height:1.6;margin:0;">Email ini dikirim otomatis oleh RYY STORE sebagai pengingat. Jika kamu sudah melakukan perpanjangan, abaikan email ini.</p>
    </div>
  </div>
</body></html>`;
}

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ success: false, message: "Method tidak diizinkan." });
  }

  const cronSecret = String(env("CRON_SECRET") || "");
  const authorization = String(req.headers.authorization || "");
  if (!cronSecret || authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ success: false, message: "Unauthorized." });
  }

  try {
    const { database, sha } = await readDatabase();
    const now = Date.now();
    let sent = 0;
    let skipped = 0;
    let failed = 0;
    let changed = false;

    for (const user of database.users || []) {
      const subscriptions = Array.isArray(user.subscriptions) ? user.subscriptions : [];
      const email = user.email || user.googleEmail || (isValidEmail(user.secondaryContact) ? user.secondaryContact : "");
      if (!isValidEmail(email)) continue;

      for (const subscription of subscriptions) {
        if (subscription?.status !== "active" || !subscription.expiresAt) continue;
        const expiresAtMs = new Date(subscription.expiresAt).getTime();
        if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now || expiresAtMs - now > DAY_MS) continue;

        // One reminder per exact expiry timestamp. If the subscription is extended,
        // the new expiresAt is different and a new reminder is allowed.
        if (subscription.reminderSentAt && subscription.reminderForExpiryAt === subscription.expiresAt) {
          skipped++;
          continue;
        }

        const remaining = remainingLabel(expiresAtMs - now);
        try {
          await sendEmail({
            to: email,
            subject: `RYY STORE — Langganan ${subscription.productName || "Premium"} tersisa ≤ 24 jam`,
            html: reminderEmail({ user, subscription, remaining, expiresAt: subscription.expiresAt })
          });

          subscription.reminderSentAt = new Date(now).toISOString();
          subscription.reminderForExpiryAt = subscription.expiresAt;
          sent++;
          changed = true;
        } catch (error) {
          failed++;
          console.error(`Gagal mengirim reminder ${user.username}/${subscription.id}:`, error);
        }
      }
    }

    if (changed) {
      await writeDatabase(database, sha, `Send subscription expiry reminders (${sent})`);
    }

    return res.status(200).json({ success: true, sent, skipped, failed });
  } catch (error) {
    console.error("Subscription reminder cron error:", error);
    return res.status(500).json({ success: false, message: "Gagal menjalankan pengingat langganan." });
  }
}

