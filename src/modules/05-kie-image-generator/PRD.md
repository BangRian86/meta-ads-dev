# PRD — 05-kie-image-generator

## Problem yang Diselesaikan

Tim media buyer butuh suplai gambar/iklan baru tiap hari. Generate
manual lewat tool design lambat. Modul ini menyediakan jalur "prompt →
gambar siap-pakai" via KIE.ai dengan lifecycle async yang tahan banting:
hilang webhook tetap bisa di-recover via polling, key invalid /
credits exhausted ter-detect otomatis dan owner mendapat sinyal jelas
untuk top up.

## Fitur Tersedia

- **Submit generate** image dari prompt + size (1:1, 3:2, 2:3, 16:9, 9:16).
- **Submit edit** image (input image URL + prompt).
- **Lifecycle async** — pending → processing → success/failed/expired.
- **Webhook callback handler** — KIE POST result, modul update asset.
- **Polling fallback** — `pollAsset`, `pollAllInflight` kalau callback hilang.
- **Asset library** — `content_assets` jadi media gallery (dipakai
  Dashboard `/creatives`).
- **Expiry tracking** — provider URL ada TTL, modul mencatat dan
  bisa flag asset expired.
- **Credential management** — multi-key `kie_credentials`, auto-mark
  invalid / credits_exhausted, bootstrap dari env.
- **Telegram facade** — `generateImageForTelegram` integrasi langsung
  untuk bot.

## Non-goals

- **Tidak meng-host file final** sendiri — URL tetap di KIE; kalau mau
  copy ke storage permanen, lakukan di modul lain.
- **Tidak melakukan auto-upload ke Meta** — itu `16-ad-publisher`.
- **Tidak ada queue priority** — first-come first-served via pg-boss / cron.
- **Tidak ada provider lain** (DALL-E, Imagen, dll) — modul khusus KIE.
  Kalau provider baru, abstraction baru dibuat di `00-foundation/provider-client`.
- **Tidak men-cache prompt → image** — setiap submit selalu hit KIE
  (image gen sifatnya non-deterministic).

## Success Metrics

- **Asset success rate ≥ 90%** — task yang submit berhasil terminal di
  state `success` (bukan failed/expired).
- **Latency end-to-end p95 < 90 detik** untuk single image (submit →
  result URL siap).
- **Callback / polling reconciliation** — 0 task stuck di `processing`
  > 10 menit (poller akan menyapu).
- **Credential health** — saat key invalid / credits habis, `kie_credentials.status`
  ter-update dalam 1 task gagal pertama (bukan setelah banyak retry).
- **Mirror konsistensi** — setiap `content_assets` row punya
  `kie_tasks` row yang cocok (provider task id sama).
