# PRD — 07-rules-management

## Problem yang Diselesaikan

Meta Ads punya fitur Automated Rules yang powerful tapi UI-nya verbose
dan tidak collaborative — tim sulit me-review apa rule mau dipublish.
Modul ini memberi flow draft (review-able) → publish, plus bahasa
manusia untuk rule existing, plus snapshot per perubahan untuk audit
history yang lengkap.

## Fitur Tersedia

- **Draft-publish workflow** — draft di DB lokal dulu, publish ke Meta
  saat siap. Discard kalau batal.
- **Rule CRUD lengkap** — create, update, enable/disable, delete.
- **Snapshot history** — `meta_rule_snapshots` simpan setiap versi
  rule (termasuk rule yang sudah dihapus).
- **Refresh snapshot** dari Meta — pull rule terbaru kalau ada
  perubahan di luar app.
- **Formatter human-readable** — translate JSON spec jadi kalimat
  ("Pause ad if Spend > $50 AND CTR < 1.0%").
- **Filter operator komprehensif** — 12 operator (IN_RANGE, GREATER_THAN,
  CONTAIN, dst) di-support.
- **Audit trail** — setiap operasi tercatat di `operation_audits`.

## Non-goals

- **Tidak meng-evaluasi rule sendiri** — eksekusi tetap di sisi Meta.
  Modul cuma manage definisi.
- **Tidak melakukan rule simulation / dry-run** — kalau rule
  di-publish, langsung aktif (kecuali di-disable).
- **Tidak ada rule template library** built-in — caller bawa spec
  sendiri.
- **Tidak meng-handle rule schedule yang custom-frequency** di luar
  yang Meta dukung — DAILY/HOURLY/CUSTOM mengikuti API.
- **Tidak ada cross-rule dependency** — modul tidak tahu rule A
  override / depend rule B.

## Success Metrics

- **Draft state machine ketat** — 0 publish dari draft yang sudah
  published / discarded (cek `DraftNotEditableError`).
- **Snapshot lengkap** — 100% perubahan rule (publish/update/delete)
  punya baris `meta_rule_snapshots` baru.
- **Formatter coverage** — 100% rule yang punya snapshot bisa
  di-`describeRule` jadi text (tidak ada "unknown field" di output normal).
- **Audit completeness** — setiap operasi tercatat di `operation_audits`
  dengan `actorId` dan diff before/after via snapshot.
