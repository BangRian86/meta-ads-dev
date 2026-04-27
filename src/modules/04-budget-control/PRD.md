# PRD — 04-budget-control

## Problem yang Diselesaikan

Mengubah budget di Meta Ads gampang merusak campaign yang sedang
learning — naik terlalu agresif → reset learning, turun terlalu jauh →
under-deliver. Selain itu, "owner" budget bisa di campaign (CBO) atau
di ad set (ABO), dan caller sering salah target. Modul ini melindungi
dari kedua masalah dengan rules + auto-detect.

## Fitur Tersedia

- **Increase / decrease budget** by percentage, pada campaign atau adset.
- **Auto-detect CBO vs ABO** — modul memutuskan field mana yang
  di-update. Caller cuma bilang "naikkan 15% untuk campaign X".
- **Hard cap +20%** per operasi increase.
- **Hard floor** — minimum daily / lifetime budget configurable.
- **Daily atau lifetime** — pilih field yang sedang aktif di Meta.
- **Audit trail** — `previousMinor`, `newMinor`, `pctChange`, `kind`
  (daily/lifetime), `level` (cbo/abo).
- **Error class spesifik** — caller bisa handle:
  `BudgetCapExceededError`, `BudgetBelowMinError`,
  `BudgetTargetMismatchError`, `NoBudgetConfiguredError`,
  `BudgetNotIncreaseError`, `BudgetNotDecreaseError`.

## Non-goals

- **Tidak handle bid strategy / bid amount** — beda problem space.
- **Tidak menentukan kapan harus naik/turun** — itu domain optimizer
  (`11-auto-optimizer`).
- **Tidak melakukan perubahan absolute amount langsung** — hanya by
  percentage (lebih aman + mudah audit).
- **Tidak melindungi dari multiple operasi berurutan dalam waktu
  singkat** — caller harus throttle sendiri kalau khawatir compound effect.
- **Tidak handle budget di account level** — hanya campaign / adset.

## Success Metrics

- **0 perubahan > 20%** per operasi (cap dipaksa di code).
- **0 budget di bawah minimum** — `assertAboveMinimum` selalu jalan.
- **0 misclick CBO/ABO** — `detectBudgetOwner` mencegah update field
  yang salah.
- **Audit completeness 100%** — setiap perubahan tercatat dengan
  before/after di `operation_audits`.
