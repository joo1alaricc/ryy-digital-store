import { env, hasBinding } from "../_env.js";
import { databaseStorageStatus, readRepoJson } from "../_github.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ success: false, message: "Method tidak diizinkan." });
  }

  const deep = String(req.query?.deep || "").toLowerCase() === "1";
  const result = {
    success: true,
    service: "RYY STORE API",
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
  } catch (error) {
    result.database = { ok: false, message: error?.message || "Database status failed." };
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
