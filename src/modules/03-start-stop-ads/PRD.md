# PRD — 03-start-stop-ads

## Problem yang Diselesaikan

Pause/unpause adalah operasi paling sering dilakukan media buyer. Tanpa
modul khusus, caller harus paham nuansa Meta: `status` vs
`effective_status`, parent chain (unpause ad tapi adset paused = ad
tetap tidak deliver), kapan harus check disapproval, dll. Modul ini
membuat operasi ini idempotent + safe + auditable.

## Fitur Tersedia

- **`pause(target)` / `unpause(target)`** untuk campaign / adset / ad.
- **Idempoten** — sudah PAUSED → noop, tanpa API call.
- **Parent chain validation** untuk unpause: deteksi parent yang masih
  paused/deleted/archived/disapproved.
- **Delivery blocker codes** terstruktur (`parent_paused`, `disapproved`,
  `pending_review`, `pending_billing`, `with_issues`, `in_process`, dll).
- **Audit trail** — setiap perubahan status tercatat dengan
  previousStatus / newStatus + actorId.
- **Token error handling** — token invalid otomatis mark connection
  `invalid` dan throw `TokenInvalidError`.

## Non-goals

- **Tidak handle DELETE / ARCHIVE** — hanya ACTIVE↔PAUSED.
- **Tidak meng-edit budget atau bid** — itu `04-budget-control`.
- **Tidak retry otomatis kalau Meta error sementara** — caller yang
  memutuskan retry strategy.
- **Tidak melakukan bulk operations** dengan batching khusus — caller
  iterasi sendiri kalau perlu.
- **Tidak meng-handle creative approval flow** — kalau ad disapproved,
  modul cuma melapor blocker, fix manual via Meta Ads Manager.

## Success Metrics

- **0 surprise blocked unpause** — saat outcome `blocked`, list
  `blockers[]` selalu jelas dengan message yang actionable.
- **Idempotency** — call pause 2× berturut-turut → operasi kedua noop,
  tidak ada API call kedua.
- **Audit completeness** — 100% perubahan status tercatat di
  `operation_audits` dengan actorId.
- **Latency p95 < 2 detik** untuk operasi single object (1 fetch + 1 mutation).
