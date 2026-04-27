# PRD — 01-manage-campaigns

## Problem yang Diselesaikan

Tim media buyer butuh cara terprogram untuk membuat campaign / ad set /
ad di Meta — tanpa risiko membuat ad yang langsung live, tanpa
duplicate kode HTTP, dan dengan jejak audit yang konsisten. Tanpa
modul ini, tiap caller (Telegram bot, optimizer, ad publisher) harus
re-implement Graph API client + audit + preflight masing-masing.

## Fitur Tersedia

- **Create campaign / ad set / ad** — auto-paused, dengan preflight
  validasi (Zod schema + business warnings) sebelum hit Meta.
- **Read** objek tunggal atau list children (campaign → adsets, adset → ads)
  dengan field map yang sesuai per object type.
- **Snapshot persistence** ke `meta_object_snapshots` setiap kali sync
  dipanggil — bisa di-query oleh modul lain (analysis, dashboard, optimizer).
- **Sync 3 mode:** single object, full campaign hierarchy, atau seluruh
  ad account (`syncAccount`).
- **Duplicate hierarchy** — copy campaign + child + sync, dengan
  rollback otomatis kalau gagal mid-flight.
- **Audit + request logging** — setiap operasi tercatat di
  `operation_audits` dan `meta_request_logs`.
- **Preflight terpisah** dari execution — caller bisa check feasibility
  tanpa side effect.

## Non-goals

- **Tidak meng-edit (update) objek existing** — start/stop di
  `03-start-stop-ads`, budget di `04-budget-control`, rules di
  `07-rules-management`.
- **Tidak menjalankan analysis / scoring** — itu domain `02-ads-analysis`.
- **Tidak meng-handle creative upload** — ad creative diasumsikan sudah
  ada (creative_id), pembuatannya di `16-ad-publisher` / `05-kie-image-generator`.
- **Tidak melakukan polling / scheduled sync** — caller (cron / job)
  yang panggil `syncAccount`.
- **Tidak meng-cache result** — read selalu hit Meta. Caller pakai
  snapshot kalau butuh data lama.

## Success Metrics

- **0 ad live by accident** — preflight + force-PAUSED policy.
- **100% operasi tercatat** — tiap create / duplicate / sync ada baris
  di `operation_audits` dan tiap HTTP call di `meta_request_logs`.
- **Snapshot freshness** — `syncCampaignHierarchy` selesai < 30 detik
  untuk campaign dengan ≤50 ads.
- **Token invalid → fail fast** — saat Meta return token error, modul
  langsung mark connection `invalid` dan throw `TokenInvalidError`
  tanpa retry liar.
- **Rollback duplicate ≥ 95% berhasil** — kalau create child gagal,
  resource parent yang baru dibuat ter-delete.
