# Migrasi BotThreads ke VPS baru (VPS 3)

Aplikasi ini **stateless**: semua data ada di Supabase, media di Supabase Storage, image dibangun GitHub
Actions dan disimpan di GHCR. Yang pindah hanya container, variabel lingkungan, Scheduled Task, dan
domain. Tidak ada database atau volume yang perlu disalin, jadi migrasi bisa dilakukan tanpa downtime
dan bisa dibatalkan kapan saja selama VPS lama belum dimatikan.

Prinsip: **VPS lama tetap melayani sampai VPS 3 terbukti sehat**, dan Scheduled Task hanya menyala di
satu server pada satu waktu.

## 0. Persiapan

- [ ] Pilih cara mengelola VPS 3 di Coolify:
  - **A (disarankan bila panel Coolify tidak ikut pindah):** Coolify lama > Servers > Add Server, masukkan
    IP VPS 3 lewat SSH key, Validate. Aplikasi baru dibuat di server ini dari panel yang sama.
  - **B (bila VPS lama yang memegang panel `coolify.sukashawarma.tech` akan dimatikan):** pasang Coolify di
    VPS 3 (`curl -fsSL https://cdn.coollabs.io/coolify/install.sh | sudo bash`), lalu pindahkan
    subdomain panel ke VPS 3 setelah aplikasi selesai dipindah.
- [ ] Firewall VPS 3: buka 22 (sebaiknya batasi ke IP Anda), 80, 443; 8000 hanya bila panel Coolify di sini.
- [ ] Router AI (`HERMES_HOST` / `HERMES_BASE_URL`): pastikan dapat dijangkau dari VPS 3. Bila router
      berjalan di VPS lama, pindahkan juga atau izinkan IP VPS 3 di firewall-nya. Tanpa ini semua fitur AI
      gagal walau aplikasi tampak sehat.
- [ ] Bila DNS tidak lewat proxy Cloudflare, turunkan TTL record domain aplikasi ke 60–300 detik sehari
      sebelumnya.
- [ ] Image GHCR privat? Coolify di VPS 3 perlu login registry: Docker login `ghcr.io` dengan PAT
      `read:packages` (di Coolify: Settings > Docker Registries, atau `docker login ghcr.io` di VPS 3).

## 1. Buat aplikasi di VPS 3 (belum menerima trafik)

- [ ] New Resource > Docker Image: `ghcr.io/rendydev404/botthreads:latest`, server VPS 3, port `3000`.
- [ ] Domain sementara, mis. `https://baru.<domain>` (record A ke IP VPS 3). Domain produksi belum dipasang.
- [ ] Health check: path `/login`, harapan HTTP 200 (sama dengan `HEALTHCHECK` di Dockerfile).
- [ ] **Jangan** buat Scheduled Task dulu.

## 2. Salin variabel lingkungan

Semua rahasia harus **identik** dengan server lama. Paling penting:

| Variabel | Bila berbeda |
| --- | --- |
| `TOKEN_ENCRYPTION_KEY` (atau `META_APP_SECRET` bila yang pertama kosong) | Token Threads di database tidak bisa dibuka: penerbit, balas komentar, insights mati |
| `AUTH_SECRET` | Semua pengguna ter-logout |
| `AUTOPILOT_CRON_SECRET` | Tick 401, autopilot berhenti |
| `THREADS_APP_SECRET` | Webhook Threads ditolak (tanda tangan salah) |

Salin semuanya sekaligus dengan skrip (nilai tidak pernah dicetak):

```bash
SRC_COOLIFY_URL=https://coolify.sukashawarma.tech SRC_COOLIFY_TOKEN=... SRC_APP_UUID=<uuid lama> \
DST_APP_UUID=<uuid baru> npm run env:copy
```

Tambahkan `DST_COOLIFY_URL` dan `DST_COOLIFY_TOKEN` bila VPS 3 punya panel Coolify sendiri (cara B).
Periksa daftarnya, lalu ulangi dengan `-- --apply`. Skrip membaca ulang tujuan dan gagal bila ada nilai
yang tidak cocok. Token sumber perlu izin `read:sensitive`.

## 3. Uji di domain sementara

- [ ] Deploy. Log tidak berisi galat env.
- [ ] `https://baru.<domain>/login` → 200, `/` tanpa sesi → 307 ke `/login`.
- [ ] Login biasa berhasil (login Google mungkin ditolak karena redirect URI masih domain produksi; itu wajar).
- [ ] Panggil tick sekali dari terminal container (Coolify > Terminal) untuk memastikan Supabase dan secret
      cocok. Aman dipanggil ganda karena tiap tick memakai lease:

```bash
node -e "fetch('http://127.0.0.1:3000/api/internal/insights/tick',{method:'POST',headers:{'x-cron-secret':process.env.AUTOPILOT_CRON_SECRET}}).then(async r=>console.log(r.status,(await r.text()).slice(0,300)))"
```

  Harapan `200`. `401` = `AUTOPILOT_CRON_SECRET` beda, `503` = belum terpasang, `500` = cek log
  (biasanya Supabase atau `TOKEN_ENCRYPTION_KEY`).

## 4. Pindah trafik (cutover, ±5 menit)

Urutan ini menjaga agar penjadwal tidak berjalan di dua server dan webhook tidak hilang.

1. [ ] VPS lama: matikan ketiga Scheduled Task (jangan dihapus dulu).
2. [ ] VPS 3: buat ketiga Scheduled Task dengan perintah yang sama persis seperti di README:
   - `*/5 * * * *` → `/api/internal/autopilot/tick`
   - `* * * * *` → `/api/internal/publisher/tick`
   - `*/5 * * * *` → `/api/internal/insights/tick`
3. [ ] Aplikasi lama: hapus domain produksi. Aplikasi baru: ganti domain sementara dengan domain produksi
       (Coolify/Caddy menerbitkan sertifikat setelah DNS mengarah ke VPS 3).
4. [ ] DNS: ubah record A domain produksi ke IP VPS 3. Bila lewat Cloudflare (proxy oranye) perubahannya
       hampir seketika dan `TRUST_CLOUDFLARE_IP=true` tetap berlaku.
5. [ ] Jangan matikan container lama: selama propagasi DNS, webhook Meta/Midtrans yang masih sampai ke
       VPS lama tetap diproses ke database yang sama.

Karena domain tetap sama, **tidak ada** yang perlu diubah di Meta (callback & webhook Threads), Google OAuth,
maupun Midtrans (URL notifikasi).

## 5. Verifikasi setelah cutover

- [ ] `https://<domain>/login` 200 dan sertifikat valid; `curl -sI https://<domain>/login` menunjukkan
      server baru (cek di log Coolify VPS 3 bahwa request masuk).
- [ ] Sesi lama tetap login (bukti `AUTH_SECRET` sama).
- [ ] Log Scheduled Task VPS 3 menunjukkan status 200 tiap putaran; halaman Autopilot tidak lagi
      memperingatkan "tick terakhir > 15 menit".
- [ ] Postingan terjadwal berikutnya terbit; komentar uji di Threads dibalas (webhook masuk ke VPS 3).
- [ ] Login Google dan satu transaksi sandbox Midtrans (bila dipakai) berhasil.

## 6. Arahkan CI ke server baru

Settings repo > Secrets and variables > Actions:

- [ ] `COOLIFY_APP_UUID` → UUID aplikasi baru.
- [ ] `COOLIFY_URL` dan secret `COOLIFY_API_TOKEN` → panel baru (hanya cara B).
- [ ] `APP_URL` tetap.

Lalu jalankan workflow **Build & Deploy** sekali secara manual (`workflow_dispatch`) dan pastikan langkah
"Verify live service health" lulus. `npm run env:push` juga perlu `COOLIFY_APP_UUID` (dan `COOLIFY_URL`
untuk cara B) baru, karena bawaan skrip itu masih aplikasi lama.

## 7. Masa tunggu dan pembersihan

- [ ] Biarkan aplikasi lama berhenti tapi utuh 3–7 hari.
- [ ] Setelah aman: hapus aplikasi lama, cabut token Coolify yang dipakai untuk `env:copy`, lalu matikan VPS lama.

## Rollback

Selama aplikasi lama belum dihapus: matikan Scheduled Task VPS 3, nyalakan lagi Scheduled Task lama,
pasang kembali domain di aplikasi lama, dan arahkan DNS kembali ke IP lama. Tidak ada data yang perlu
dikembalikan karena kedua server memakai Supabase yang sama.
