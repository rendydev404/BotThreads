This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Posting AI ke Threads (Jadwal)

Asisten AI merekomendasikan draf Threads siap posting per akun cabang. Pengguna memilih **Posting sekarang** atau **Jadwalkan** (WIB). Dashboard hanya **menulis ke antrean bersama** (`ScheduledPost` dengan `source='DASHBOARD_AI'` + `PostDispatch` dengan `publisher='THREADS'`); worker `threads-publisher` di repo auto-suka yang menerbitkan. Dashboard tidak menyimpan token Threads dan AI tidak pernah memposting tanpa klik pengguna.

Akses data memakai `supabase-js` (service role, hanya di server). Penulisan antrean dan query kompleks dilakukan lewat fungsi RPC `SECURITY DEFINER` (`dash_*`), sehingga service role tidak butuh GRANT langsung ke tabel milik auto-suka.

### Setup database (sekali, oleh pemilik)

Jalankan berurutan di SQL Editor Supabase (aditif, idempoten, tidak mengubah/menghapus data):

1. `supabase/setup.sql` (sudah ada: grant + fungsi agregasi analitik)
2. `sql/002_dashboard_post_log.sql` (tabel audit `DashboardPostLog`)
3. `sql/003_dashboard_rpc.sql` (fungsi RPC penjadwalan/antrean)

Env wajib: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

### Variabel lingkungan fitur

| Variabel | Default | Fungsi |
| --- | --- | --- |
| `CONTENT_PUBLISH_ENABLED` | mati | Kill switch. Selama bukan `true`, semua endpoint tulis membalas 403 dan tombol Posting/Jadwalkan dinonaktifkan. |
| `CONTENT_PUBLISH_TEST_ACCOUNTS` | kosong | Daftar id atau username akun Threads (dipisah koma) yang boleh diposting. Kosong berarti tanpa pembatasan akun. |
| `CONTENT_MAX_POSTS_PER_DAY` | `6` | Batas posting per akun per hari (WIB). |
| `CONTENT_MIN_GAP_MINUTES` | `0` | Jarak minimum antar posting pada akun yang sama (`0` = tanpa batas). |
| `HERMES_API_KEY` | - | Kunci router AI (9Router). Tanpa ini semua panggilan AI langsung memakai Gemini. |
| `HERMES_BASE_URL` | `http://$HERMES_HOST:$NINE_ROUTER_PORT/v1` | Alamat router AI bergaya OpenAI. |
| `HERMES_MODELS` | `hermes-combo` | Model router, dipisah koma, dicoba berurutan. |
| `GEMINI_API_KEY` | - | Cadangan bila router gagal (sisi server saja). |
| `ORCHESTRATE_CONCURRENCY` | `10` | Jumlah agen Multi-Agent Orchestrator yang berjalan serentak (1-16). |

### Tes

```bash
npm test
```