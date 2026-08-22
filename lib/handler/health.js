import { env } from "../_env.js";
import { readRepoJson } from "../_github.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ success:false, message:"Method tidak diizinkan." });

  const deep = String(req.query?.deep || "").toLowerCase() === "1";
  const result = {
    success: true,
    service: "RYY STORE API",
    runtime: "Cloudflare Pages Worker",
    time: new Date().toISOString()
  };

  // Safe diagnostics: only reports whether required runtime configuration exists.
  // It never returns secret values.
  if (deep) {
    result.config = {
      APP_SECRET: Boolean(env("APP_SECRET")),
      GITHUB_TOKEN: Boolean(env("GITHUB_TOKEN")),
      GITHUB_OWNER: Boolean(env("GITHUB_OWNER")),
      GITHUB_REPO: Boolean(env("GITHUB_REPO")),
      GITHUB_BRANCH: Boolean(env("GITHUB_BRANCH") || "main"),
      GITHUB_PATH: Boolean(env("GITHUB_PATH") || "data/database.json"),
      GMAIL_USER: Boolean(env("GMAIL_USER")),
      GMAIL_CLIENT_ID: Boolean(env("GMAIL_CLIENT_ID")),
      GMAIL_CLIENT_SECRET: Boolean(env("GMAIL_CLIENT_SECRET")),
      GMAIL_REFRESH_TOKEN: Boolean(env("GMAIL_REFRESH_TOKEN"))
    };

    if (result.config.GITHUB_TOKEN && result.config.GITHUB_OWNER && result.config.GITHUB_REPO) {
      try {
        const path = env("GITHUB_PATH") || "data/database.json";
        const repo = await readRepoJson(path);
        result.github = { ok: true, path, hasDatabaseObject: !!repo?.data };
      } catch (error) {
        result.github = { ok: false, message: error?.message || "GitHub read failed." };
      }
    } else {
      result.github = { ok: false, message: "Konfigurasi GitHub belum lengkap." };
    }
  }

  return res.status(200).json(result);
}
