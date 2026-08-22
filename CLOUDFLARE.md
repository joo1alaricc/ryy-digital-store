# RYY STORE — Cloudflare Pages Setup

Project ini memakai Cloudflare Pages Advanced Mode melalui `_worker.js`.

## Wajib diatur di Cloudflare

Masuk ke **Cloudflare Dashboard → Workers & Pages → ryy-store → Settings → Variables and Secrets**.
Tambahkan secrets berikut untuk **Production** (dan Preview jika diperlukan):

- `APP_SECRET` — string acak panjang, jangan dibagikan.
- `GITHUB_TOKEN` — token GitHub yang memiliki izin membaca dan menulis repository database.
- `GITHUB_OWNER` — username/owner repository.
- `GITHUB_REPO` — nama repository.
- `GITHUB_BRANCH` — biasanya `main`.
- `GITHUB_PATH` — biasanya `data/database.json`.
- `GOOGLE_CLIENT_ID` — jika Login Google dipakai.
- `GMAIL_USER`
- `GMAIL_CLIENT_ID`
- `GMAIL_CLIENT_SECRET`
- `GMAIL_REFRESH_TOKEN` — diperlukan untuk OTP email.

## Cek deployment

Setelah deploy, buka:

`/api/health?deep=1`

Semua nilai pada `config` yang diperlukan harus `true`, dan bagian `github.ok` harus `true`.

Jika login user gagal, endpoint ini membantu membedakan masalah konfigurasi Cloudflare dari masalah UI.
