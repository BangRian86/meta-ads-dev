# 08-video-generator — PRD

## Problem

Operator perlu cara cepat bikin video iklan Aqiqah / Umroh tanpa harus
buka tool eksternal. Image generator (`/generate`, `/generate_umroh`)
sudah ada — versi video adalah extension natural untuk creative
production loop yang sama.

## Goal

- Approver bisa kirim `/video <prompt>` di Telegram dan dapat balasan
  mp4 dalam < 5 menit (target).
- Tiga entry point: text-to-video generic, text-to-video umroh
  (Basmalah brand voice), image-to-video (lift gambar jadi animasi).
- Hasil tersimpan di content library (`content_assets`) supaya bisa
  reused buat publish ke Meta nanti.

## Non-goals (v1)

- Bukan publishing langsung ke Meta — hanya menghasilkan asset; publish
  pakai modul 16 yang terpisah.
- Bukan editor video — KIE return URL final, tidak ada trimming.
- Bukan bulk generation — satu task per command call.

## Stakeholder

- **Approver** (Bang Rian, Naila): trigger via Telegram, expect mp4.
- **Owner** (Bang Rian): set KIE_API_KEY di env; pantau credit usage
  via `kie_tasks` analytics nanti.
- **Audit** (compliance): `operation_audits` untuk trace siapa minta
  apa kapan.

## Specs

### Telegram commands

| Command | Mode | Prompt | Defaults |
|---|---|---|---|
| `/video <deskripsi>` | T2V | Aqiqah generic | 720p, 10s, 16:9 |
| `/video_umroh <deskripsi>` | T2V | Basmalah/umroh prefix | 720p, 10s, 16:9 |
| `/video_image <deskripsi>` | I2V | + first_frame_url dari reply photo | 720p, 10s |

Semua command approver-only (gating via `wrap(..., { approver: true })`).

### Provider

KIE.ai Wan 2.7:
- T2V: `wan/2-7-text-to-video` (POST `/api/v1/jobs/createTask`)
- I2V: `wan/2-7-image-to-video` (sama endpoint, model beda)
- Polling: GET `/api/v1/jobs/recordInfo?taskId=…`
- States: waiting, queuing, generating, success, fail
- Credit: per durasi × resolusi (Wan tarif lebih mahal dari Kling/
  Hunyuan; eyeballing dari KIE docs ~5-15× credit per detik vs image).

### Output

- Format: mp4 (Wan native).
- TTL: same as image (`config.kie.assetDefaultTtlMs`, default 14d).
- Provider URL expire — cache to local storage TBD (out-of-scope v1).

## Risiko

- **Cost**: video gen lebih mahal dari image. Tanpa rate-limit per user,
  satu approver bisa abuse credit. Mitigation v1: hanya approver yang
  bisa trigger; future: per-day quota per actor.
- **Latency**: Wan kadang antri 3-5 menit. Telegram bot di-instruct
  kasih ETA "1-3 menit" tapi siap timeout 8 menit di poller.
- **Model availability**: Wan 2.7 masih relatif baru di KIE — kalau
  KIE deprecate, override model name via `extra.model` atau swap
  provider.
- **Schema migration**: enum `content_asset_type` butuh extension. SQL
  migration `ALTER TYPE … ADD VALUE` aman di PG14+ (non-blocking) tapi
  butuh apply manual `npm run db:migrate` setelah deploy.

## Backout

Hapus folder `08-video-generator/`, revert command wires di
`10-telegram-bot/commands.ts`, revert enum extension di schema. Asset
rows yang sudah terlanjur tertulis tetap di-content_assets tapi enum
value lama tidak dipakai aktif — drop dari enum butuh DROP TYPE +
recreate; biarkan saja.

## Open questions

- Apakah perlu callback URL (push) atau cukup polling? Saat ini polling
  cukup (Telegram bot punya event loop). Future: kalau jam puncak
  banyak request, set `KIE_CALLBACK_URL` supaya KIE push dan poller
  cuma jadi safety net.
- Berapa hari TTL ideal untuk content video (size besar)? Default
  14 hari (sama image) mungkin terlalu lama untuk video; revisit
  setelah 1 bulan operasi.
