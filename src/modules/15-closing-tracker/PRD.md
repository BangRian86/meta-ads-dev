# PRD — 15-closing-tracker

## Problem yang Diselesaikan

ROAS yang akurat butuh revenue real (closing transaksi), bukan
attribution Meta yang sering proxy (lead ≠ closing). Tim sales input
closing ke Sheets, tapi modul lain butuh angka itu untuk laporan,
optimizer, ROAS alert. Tanpa modul ini, tiap caller akan join Sheets +
Meta sendiri = duplicate logic + inkonsistensi.

## Fitur Tersedia

- **ROAS report** untuk range arbitrary (default kemarin).
- **Per-account breakdown** — spend Meta + revenue Sheets + closing
  count + ROAS + unit (jamaah/ekor).
- **Per-campaign breakdown** — meskipun attribution kasar.
- **Source tagging** — `sheets` / `manual` / `none`.
- **Manual fallback** — `recordClosing` saat Sheets tidak update on time.
- **Connection alias resolver** — find connection by partial name
  (untuk `/closing` Telegram command).
- **Bahasa Indonesia formatter** — IDR + jamaah/ekor + tanggal.

## Non-goals

- **Tidak meng-edit Sheets** — write hanya ke `closing_records` lokal.
- **Tidak handle multi-currency** — IDR only.
- **Tidak melakukan attribution model alternatif** — pakai data
  yang ada (sheets primary, manual fallback).
- **Tidak menyediakan analytics historis dalam** — single report per
  range.
- **Tidak handle refund / cancellation** — closing tercatat = final.

## Success Metrics

- **Source coverage ≥ 90%** — sebagian besar akun ada data Sheets
  pada hari laporan dijalankan.
- **Manual fallback rate < 10%** — tim Sheets update tepat waktu.
- **ROAS akurasi** — angka match dengan rekap Sheets manual (paling
  ≤ 5% deviation karena rounding).
- **Latency p95 < 6 detik** untuk full report (5 connection × analyze
  + Sheets read).
- **Audit jejak `closing_records`** — manual entry punya `createdBy`
  selalu non-null.
