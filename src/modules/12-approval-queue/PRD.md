# PRD — 12-approval-queue

## Problem yang Diselesaikan

Bot otomatisasi yang langsung eksekusi tanpa approval = berisiko (salah
classify, salah threshold, edge case yang tidak ke-test). Tapi
approval flow yang ad-hoc per command juga mahal (duplicate code,
inconsistent UX, susah audit). Modul ini menyediakan satu queue
generic dengan UX seragam ("Ketik ya/tidak"), TTL, dan executor
dispatcher.

## Fitur Tersedia

- **Enqueue action** dengan kind, payload, summary, requestedBy, TTL.
- **List pending** untuk approver (`/pending`).
- **Find by shortId** untuk approval reply (`/yes <id>`, `/no <id>`).
- **Execute on approval** — dispatcher otomatis route ke modul yang
  benar berdasarkan `actionKind`.
- **Mark state** — approved / rejected / executed / failed.
- **TTL expiry** — entry yang lewat TTL tidak akan executed.
- **9 action kind** built-in: pause, resume, budget, audience_engagement,
  audience_lookalike, copy_approve, auto_pause, auto_scale, publish_ad.
- **Formatter konsisten** — pesan `formatConfirmation` 5-line fixed.

## Non-goals

- **Tidak ada multi-approver** — single approval cukup (pakai
  `TELEGRAM_APPROVED_USER_IDS` di sisi bot untuk gating).
- **Tidak ada priority queue** — FIFO via `created_at`.
- **Tidak ada complex scheduling** — execute-on-approval saja.
- **Tidak handle action chain** — kalau action butuh action lain,
  caller enqueue 2 entry terpisah.
- **Tidak ada UI selain Telegram** — dashboard cuma read.

## Success Metrics

- **Approval latency p95** — sejak enqueue sampai approve < 30 menit
  saat owner aktif.
- **Expiry rate** — < 20% pending action expired tanpa approval (kalau
  > 20%, indikasi notifikasi tidak ke-baca / TTL terlalu pendek).
- **Execute success rate** — > 95% action approved sukses executed.
- **0 action eksekusi tanpa approval** — `executePending` cuma
  dipanggil setelah `markApproved`.
- **Audit jejak lengkap** — semua transition state tercatat di
  `pending_actions` + dispatcher modul (lewat `withAudit`).
