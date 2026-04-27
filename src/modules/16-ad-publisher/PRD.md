# PRD — 16-ad-publisher

## Problem yang Diselesaikan

Workflow "ad performance buruk → AI generate copy fix → owner approve →
ad baru live" akan terhenti di langkah terakhir tanpa modul ini. Build
creative + ad via Meta Ads Manager manual = lambat, error-prone (paste
text salah, lupa target). Modul ini meng-otomatisasi: clone struktur
source ad yang sudah lama running, hanya swap text-nya saja.

## Fitur Tersedia

- **`enqueuePublishAd(variantId)`** — validasi variant approved +
  enqueue pending action.
- **`executePublishAd(payload)`** — auto-dispatched dari approval queue.
- **Clone object_story_spec** — primary text / headline / description /
  CTA di-swap dari variant.
- **Force PAUSED** — ad baru tidak auto-live.
- **Audit lengkap** — `withAudit` wrap, request body + response di
  `meta_request_logs` dan `operation_audits`.
- **Group notification** — saat eksekusi sukses, kirim summary ke
  group bisnis.
- **Reject reason yang jelas** — "variant not approved", "source ad
  uses object_story_id", dll, untuk debugging via Telegram.

## Non-goals

- **Tidak meng-create campaign / adset** baru — pakai
  `01-manage-campaigns`.
- **Tidak handle image / video creative** — text swap only. Kalau ada
  asset image baru, harus disetel di `object_story_spec.image_hash`
  dulu di luar modul.
- **Tidak handle source ad yang pakai `object_story_id`** —
  modul cuma support ad dengan `object_story_spec` inline.
- **Tidak ada rollback otomatis** — kalau ad baru ternyata buruk,
  pause/delete via modul lain.
- **Tidak men-decide kapan publish** — itu human approver via
  approval-queue.

## Success Metrics

- **Publish success rate ≥ 90%** (variant approved → ad baru live PAUSED).
- **0 ad live tanpa approval** — selalu lewat approval queue.
- **Latency publish (post-approval) p95 < 10 detik** — 2 Meta call
  (creative + ad).
- **Audit traceability** — setiap publish punya record di
  `operation_audits` dengan `newAdId` + `newCreativeId`.
- **Reject rate < 20%** — variant yang gagal publish karena validasi
  (pre-flight) kecil — kalau besar berarti pipeline upstream
  (copywriting-lab / optimizer) kurang ketat.
