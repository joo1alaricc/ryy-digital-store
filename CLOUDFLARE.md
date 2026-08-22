# RYY STORE — Cloudflare Pages / Node 22 Setup

Project ini menggunakan **Cloudflare Pages Advanced Mode** dengan `_worker.js`.

> Penting: Node.js 22 adalah target **build/tooling**. Request production tetap berjalan di Cloudflare Workers runtime, bukan server Node.js 22 biasa. Cloudflare saat ini menyediakan kompatibilitas Node.js di Workers; konfigurasi project juga menetapkan Node 22 untuk build. 

## 1. Build

Set **Node.js version = 22** pada environment/build settings Cloudflare Pages jika opsi tersebut tersedia.
Project juga memiliki `.nvmrc`, `.node-version`, dan `engines.node` untuk menjaga konsistensi.

Build command:

```text
npm run build
```

Build output directory:

```text
.
```

## 2. KV — database utama

Mode baru memakai `STORE_KV` sebagai database utama untuk login, register, profile, checkout, inbox, support, dan fitur user lain yang menggunakan `readDatabase()` / `writeDatabase()`.

Binding yang dibutuhkan:

- `STORE_KV`

`wrangler.jsonc` sudah berisi binding tersebut. Jika deployment Pages tidak mengambil binding dari konfigurasi, tambahkan binding KV yang sama dari dashboard Pages → Settings → Functions → Bindings.

Pada first request, KV akan di-seed dari:

1. GitHub `data/database.json` jika GitHub dikonfigurasi; atau
2. bundled private copy dari `data/database.json` jika GitHub tidak tersedia.

`data/` tetap dikecualikan dari static assets supaya database user tidak dapat diunduh langsung dari website.

Jadi **GitHub tidak lagi menjadi single point of failure untuk login**.

## 3. Secrets wajib

### Wajib untuk login/session

- `APP_SECRET` — random secret panjang, jangan dibagikan.

### Wajib untuk OTP email

- `GMAIL_USER`
- `GMAIL_CLIENT_ID`
- `GMAIL_CLIENT_SECRET`
- `GMAIL_REFRESH_TOKEN`

### Opsional — backup/sinkronisasi GitHub

- `GITHUB_TOKEN`
- `GITHUB_OWNER`
- `GITHUB_REPO`
- `GITHUB_BRANCH` — default `main`
- `GITHUB_PATH` — default `data/database.json`

Jika GitHub tidak diset tetapi `STORE_KV` aktif, login/register tetap dapat berjalan menggunakan KV + bundled database seed.

### Opsional — Login Google

- `GOOGLE_CLIENT_ID`

### Opsional — fitur lain

- `GEMINI_API_KEY`
- `GEMINI_MODEL`
- `CRON_SECRET`

## 4. Health check

Setelah deploy, buka:

```text
/api/health?deep=1
```

Yang paling penting:

- `api` harus `ok`
- `config.APP_SECRET` harus `true`
- `config.STORE_KV` harus `true`
- `config.ASSETS` harus `true`
- `database.primary` idealnya `kv`
- `database.initialized` menjadi `true` setelah database pertama kali dibaca

GitHub boleh `false/optional` jika memang tidak digunakan sebagai backup.

## 5. Jika login masih gagal

Lihat pesan yang muncul di bawah tombol login. Versi baru tidak lagi menelan error server menjadi pesan generik.

Contoh:

```text
Konfigurasi GitHub belum lengkap ...
```

atau

```text
APP_SECRET belum dikonfigurasi ...
```

atau

```text
Server terlalu lama merespons ...
```

Dengan begitu penyebabnya dapat dibedakan langsung dari sisi browser.

## Auth deep-fix (23 Aug 2026)

The authentication path no longer requires GitHub to be available. On first request, `STORE_KV` is initialized from the GitHub database when available; otherwise the Worker uses the bundled private copy of `data/database.json`. The database file remains excluded from public static assets.

Run these checks after every deployment:

- `/api/health?deep=1` — confirms the actual database read path used by login and seeds KV if needed.
- `/api/health?deep=1&mail=1` — additionally validates the Gmail OAuth refresh token without sending an email.

A healthy auth deployment should report `database.runtimeStorage` as `kv`, `database.userCount` greater than zero, `auth.loginReady: true`, and `auth.googleReady: true` when Google is configured. OTP additionally requires `auth.otpConfigReady: true` and the Gmail OAuth diagnostic to report `oauth: "valid"`.
