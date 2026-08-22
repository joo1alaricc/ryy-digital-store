import { env, hasBinding } from "../_env.js";
import { databaseStorageStatus, readDatabase, readRepoJson } from "../_github.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ success: false, message: "Method tidak diizinkan." });
  }

  const deep = String(req.query?.deep || "").toLowerCase() === "1";
  const result = {
    success: true,
    service: "RYY STORE API",
    build: "cloudflare-store-v3-2026-08-22",
    runtime: "Cloudflare Pages Advanced Mode",
    time: new Date().toISOString(),
    api: "ok"
  };

  if (!deep) return res.status(200).json(result);

  result.config = {
    APP_SECRET: Boolean(env("APP_SECRET")),
    STORE_KV: hasBinding("STORE_KV"),
    ASSETS: hasBinding("ASSETS"),
    GITHUB_TOKEN: Boolean(env("GITHUB_TOKEN")),
    GITHUB_OWNER: Boolean(env("GITHUB_OWNER")),
    GITHUB_REPO: Boolean(env("GITHUB_REPO")),
    GITHUB_BRANCH: Boolean(env("GITHUB_BRANCH") || "main"),
    GITHUB_PATH: Boolean(env("GITHUB_PATH") || "data/database.json"),
    GMAIL_USER: Boolean(env("GMAIL_USER")),
    GMAIL_CLIENT_ID: Boolean(env("GMAIL_CLIENT_ID")),
    GMAIL_CLIENT_SECRET: Boolean(env("GMAIL_CLIENT_SECRET")),
    GMAIL_REFRESH_TOKEN: Boolean(env("GMAIL_REFRESH_TOKEN")),
    GOOGLE_CLIENT_ID: Boolean(env("GOOGLE_CLIENT_ID"))
  };

  try {
    result.database = await databaseStorageStatus();
    // Deep health intentionally performs the same read path used by login.
    // If KV is empty, this seeds it from GitHub, a deployed asset, or the
    // bundled private seed so health and login cannot disagree.
    const loaded = await readDatabase();
    result.database = {
      ...result.database,
      runtimeStorage: loaded.storage,
      userCount: Array.isArray(loaded.database?.users) ? loaded.database.users.length : 0
    };
    result.auth = {
      loginReady: Boolean(result.config.APP_SECRET && result.config.STORE_KV && result.database.userCount >= 0),
      googleReady: Boolean(result.config.APP_SECRET && result.config.STORE_KV && result.config.GOOGLE_CLIENT_ID),
      otpConfigReady: Boolean(result.config.APP_SECRET && result.config.GMAIL_USER && result.config.GMAIL_CLIENT_ID && result.config.GMAIL_CLIENT_SECRET && result.config.GMAIL_REFRESH_TOKEN)
    };
  } catch (error) {
    result.database = { ok: false, message: error?.message || "Database status failed." };
    result.auth = { loginReady: false, googleReady: false, otpConfigReady: false };
  }

  if (String(req.query?.mail || "") === "1") {
    try {
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
      const data = await response.json().catch(() => ({}));
      result.gmail = response.ok && data.access_token
        ? { ok: true, oauth: "valid" }
        : { ok: false, oauth: "invalid", status: response.status, message: data.error_description || data.error || "OAuth Gmail gagal." };
    } catch (error) {
      result.gmail = { ok: false, message: error?.message || "Gagal menghubungi Google OAuth." };
    }
  }

  // GitHub is optional when STORE_KV is configured. Only test it when the
  // credentials exist, so a missing GitHub token cannot make health look broken.
  if (result.config.GITHUB_TOKEN && result.config.GITHUB_OWNER && result.config.GITHUB_REPO) {
    try {
      const path = env("GITHUB_PATH") || "data/database.json";
      const repo = await readRepoJson(path);
      result.github = { ok: true, path, hasDatabaseObject: !!repo?.data };
    } catch (error) {
      result.github = { ok: false, message: error?.message || "GitHub read failed." };
    }
  } else {
    result.github = { ok: true, optional: true, message: "GitHub backup tidak dikonfigurasi; KV dapat digunakan sebagai database utama." };
  }

  return res.status(200).json(result);
}
