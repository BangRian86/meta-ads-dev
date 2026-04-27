# 08-video-generator — Blueprint

## Tujuan

Generate video iklan (Aqiqah Express, Basmalah Travel) dari prompt text
atau dari gambar reference, lewat KIE.ai Wan 2.7 model. Dipanggil dari
Telegram bot (commands `/video`, `/video_umroh`, `/video_image`),
hasilnya dikirim sebagai mp4 ke group.

## Arsitektur

```
Telegram /video <prompt>
        │
        ▼
┌───────────────────┐    submit + audit    ┌──────────────────────┐
│ telegram-flow.ts  │ ───────────────────▶ │ service.ts (withAudit) │
└───────────────────┘                      └──────────────────────┘
        │                                            │
        │                                            ▼
        │                                ┌────────────────────────┐
        │                                │ provider.ts            │
        │                                │ (VideoProvider iface)  │
        │                                └────────────────────────┘
        │                                            │
        │                            ┌───────────────┴───────────────┐
        │                            ▼                               ▼
        │                  kie-video-client.ts          (future) other-provider.ts
        │                            │
        │                            ▼
        │                  KIE.ai /api/v1/jobs/createTask
        │                  model=wan/2-7-text-to-video
        │
        ▼
┌──────────────────────┐  poll loop (6s × max 80)
│ poller.ts            │ ────────────────────────────▶ KIE recordInfo
│ pollVideoAsset()     │
└──────────────────────┘
        │
        ▼
content_assets row updated → telegram-flow returns mp4 URL
        │
        ▼
ctx.replyWithVideo(url)
```

## Tabel yang ditulis

- `content_assets` — primary record, status pending → success/failed.
  asset_type: `video_generated` (T2V) atau `video_image_to_video` (I2V).
- `kie_tasks` — mirror lifecycle untuk billing analytics. task_type:
  `video.generate` / `video.image_to_video`. provider field disimpan
  untuk pisahin Wan vs (kalau nanti tambah) Veo/Kling.
- `operation_audits` — write-op audit lewat `withAudit()`. Operation
  type: `kie.video.generate`, `kie.video.image_to_video`,
  `kie.video.completed`, `kie.video.failed`.

Note: `content_asset_type` enum perlu di-ALTER untuk tambah dua nilai
baru. Migration di-generate via drizzle-kit; apply manual via
`npm run db:migrate`.

## Provider abstraction

`provider.ts` mendefinisikan `VideoProvider` interface dengan method
`submit()` dan `fetchDetail()`. Concrete impl saat ini cuma
`kie-video-client.ts` (Wan 2.7). Service/telegram-flow accept
`VideoProvider` sebagai parameter optional — default ke
`kieVideoProvider`. Swap implementation tanpa edit downstream.

## Polling

- Interval: 6 detik (Wan butuh 1-3 menit; lebih sering = waste credit).
- Timeout: 8 menit (hard cap).
- Idempotent — boleh re-poll asset yang sudah terminal (success/failed)
  tanpa side-effect.

## Error paths

- KIE_API_KEY missing → return ok=false dengan pesan setup.
- Tidak ada Meta connection aktif → audit row butuh connectionId, jadi
  reject dengan pesan jelas.
- Submit gagal (HTTP 4xx, kredensial invalid, credit habis) → audit
  failed via `withAudit`, propagate error message.
- Poll timeout → mark mirror failed, return reason ke caller.
- KIE return resultJson kosong padahal state=success → return ok=true
  tapi resultUrls=[]; caller (Telegram) harus handle gracefully.
