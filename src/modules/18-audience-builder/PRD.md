# PRD — 18-audience-builder

## Problem yang Diselesaikan

Custom audience adalah primitive yang dipakai banyak fitur:
optimizer (re-targeting setup), approval-queue (`audience_lookalike` /
`audience_engagement` action), dashboard (list semua audience),
Telegram bot (`/audiences`, `/create_audience`). Sebelumnya semua
caller import langsung dari `11-auto-optimizer/audience-creator.ts`,
yang menciptakan circular dependency 11↔12 dan
mempersulit refactor optimizer.

## Fitur Tersedia

- **Engagement audience** dari single source (IG profile atau FB page)
  dengan retention 30 / 60 / 90 hari.
- **Multi-source engagement** — gabung IG + FB engagers dari satu ad
  account (baca `page_id` + `ig_business_id` dari `meta_connections`).
- **Lookalike per ratio** (1%–20%, max 6 ratio per call) — tiap ratio
  jadi audience terpisah dengan audit row sendiri.
- **List audiences** dari satu ad account (top 200, single page).
- **Audit lengkap** via `withAudit` untuk setiap write.
- **Error mapping konsisten** — token invalid auto-mark connection
  `invalid` + throw `TokenInvalidError`.

## Non-goals

- **Tidak handle customer-list / file upload audience** — itu data
  privacy-sensitive, butuh flow upload + opt-in tracking yang belum
  dibangun.
- **Tidak ada audience overlap analysis** — fitur Meta's "Audience
  Overlap" tidak di-expose.
- **Tidak men-share audience antar ad account** — tiap connection
  punya audience sendiri.
- **Tidak men-decide kapan create audience** — itu domain optimizer
  atau Telegram command.
- **Tidak ada UI untuk delete audience** — manual via Meta Ads
  Manager.

## Success Metrics

- **Audience creation success rate ≥ 95%** untuk connection aktif.
- **`listMetaAudiences` p95 latency < 4 detik** untuk 200 audience.
- **0 cycle dependency** — modul ini hanya import dari
  `00-foundation`, tidak dari modul ekstensi lain.
- **Audit completeness 100%** — setiap audience yang dibuat ada di
  `operation_audits` dengan `targetId` = audience id Meta.
