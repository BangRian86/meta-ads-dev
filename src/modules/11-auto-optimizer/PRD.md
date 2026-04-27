# PRD — 11-auto-optimizer

## Problem yang Diselesaikan

Manual monitoring 10+ ad account tiap 3 jam tidak skalabel. Spend
tanpa hasil = burn money, performance bagus yang tidak di-scale = miss
opportunity, copy yang underperform tidak ke-flag. Modul ini me-loop
semua connection aktif tiap 3 jam, evaluasi by rules, dan eksekusi
(atau queue untuk approval).

## Fitur Tersedia

- **Run end-to-end per connection** — evaluate → execute decisions.
- **5 decision kinds:** auto_pause, auto_scale, resume_notify,
  cpr_alert, copy_fix_suggestion.
- **DryRun mode** — evaluate tanpa eksekusi (untuk debugging).
- **NotifyOnly mode** — semua decision jadi notification, tidak
  eksekusi action.
- **Approval-aware** — decision destructive di-route ke
  `12-approval-queue` saat policy butuh manual confirm.
- **Anomaly detection** — di-trigger di akhir runner via
  `17-anomaly-alerts`.
- **Audience builder** — engagement (IG/FB), lookalike, multi-source.
- **List Meta audiences** — read live untuk dashboard / Telegram
  `/audiences`.
- **Token-error resilient** — abort connection, 1 notify, lanjut connection
  lain (caller iterasi).

## Non-goals

- **Tidak menentukan threshold spend / CPR sendiri** — pakai default
  dari `02-ads-analysis/recommendations` (atau env config).
- **Tidak ada ML / forecasting** — rule-based dengan threshold.
- **Tidak handle ad-level decisions** secara mendalam — fokus campaign
  (auto_pause, auto_scale di campaign level; copy_fix_suggestion di ad).
- **Tidak melakukan retry independent** — kalau Meta error transient,
  cron run berikutnya yang re-evaluate.
- **Tidak ada per-account custom config** — policy seragam dari env.

## Success Metrics

- **Burn-money reduction** — spend tanpa hasil > threshold turun
  setelah auto_pause aktif (validasi mingguan via Sheets daily).
- **Decision latency** — sejak campaign masuk kondisi trigger sampai
  decision dieksekusi/notif < 3 jam (1 cron cycle).
- **False positive rate auto_pause < 10%** — campaign yang di-pause
  oleh optimizer ternyata bukan pause-worthy (validasi human).
- **Audit completeness** — setiap decision (executed atau notified)
  tercatat di `operation_audits` atau notifikasi terkirim.
- **Token error visibility** — saat `meta_connections.status='invalid'`,
  owner dapat 1 notif jelas (bukan spam).
