# PRD — 02-ads-analysis

## Problem yang Diselesaikan

Insight Meta datang sebagai array action / cost_per_action yang verbose
dan tidak konsisten antar objektif (purchase vs lead vs ATC). Modul ini
menormalkan jadi satu shape `PerformanceSummary`, menambah cache layer
(supaya tidak hit Meta untuk pertanyaan yang sama berulang), dan
menerjemahkan angka ke rekomendasi yang bisa di-action manusia.

## Fitur Tersedia

- **Fetch insights** per target (campaign/adset/ad) untuk date range
  arbitrary, otomatis log ke `meta_request_logs`.
- **Snapshot caching** — read-through cache di `meta_insight_snapshots`
  dengan TTL configurable (mengurangi cost API call).
- **Summarize** raw rows → `PerformanceSummary` dengan auto-detect
  result metric (purchase / lead / ATC / link_click priority).
- **Rank performers** — top N target by metric tertentu.
- **Recommendations** — rule-based, severity critical/warning/info,
  threshold tunable.
- **Compare 2 periode** — delta absolute + persen per metric.

## Non-goals

- **Tidak meng-eksekusi tindakan** — output cuma summary +
  recommendation; action di modul lain.
- **Tidak handle attribution model custom** — pakai Meta default.
- **Tidak menyimpan time series** — snapshot adalah point-in-time
  untuk satu range, bukan history granular.
- **Tidak mengakses Sheets / external sumber** — pure Meta insights.
- **Tidak melakukan ML / forecasting** — rekomendasi rule-based.

## Success Metrics

- **Cache hit rate ≥ 60%** untuk pertanyaan analisis berulang dalam
  TTL window.
- **Latency p95 < 1.5 detik** kalau cache hit, < 5 detik kalau cache miss.
- **Recommendation precision** — saat severity=critical, ≥ 80%
  divalidasi oleh human reviewer (low CTR yang memang harus diturunkan,
  zero-result spend yang memang harus di-pause).
- **Konsistensi result metric** — `resultActionType` field jelas untuk
  setiap summary (tidak null kecuali memang tidak ada conversion).
