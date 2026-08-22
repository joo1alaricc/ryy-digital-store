# RYY STORE - Cloudflare Pages

## Deployment
- Framework preset: None
- Build command: none
- Build output directory: `.`
- Advanced Mode entrypoint: `_worker.js`
- `wrangler.jsonc` uses `pages_build_output_dir: "."` and `nodejs_compat`.

## Required Production Secrets
Set these in Cloudflare Pages/Workers Variables & Secrets:
`APP_SECRET`, `GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_BRANCH`, `GITHUB_PATH`,
`GOOGLE_CLIENT_ID`, `GMAIL_USER`, `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`.

Do not publish `config.json` or `data/database.json`; `.assetsignore` excludes server-side files.

## API smoke test
After deployment open `/api/health`. It should return JSON with `success: true`.
