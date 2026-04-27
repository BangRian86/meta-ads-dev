# PRD — 17-anomaly-alerts

## Problem yang Diselesaikan

Optimizer cron tiap 3 jam tidak cukup cepat untuk anomali — campaign
tiba-tiba berhenti spend, atau tiba-tiba spike abnormal, butuh sinyal
< 1 jam untuk owner respond. Tapi alert tanpa dedupe akan spam channel
group setiap cycle. Modul ini menyediakan deteksi cepat dengan dedupe
6 jam.

## Fitur Tersedia

- **4 anomaly kind:** spend_drop, spend_spike, no_impressions, cpr_spike.
- **Per-campaign granularity** — tiap campaign aktif di-evaluasi.
- **Dedupe 6 jam** via `alert_dedupe` — same key tidak fire ulang
  dalam window.
- **Group push** — alert masuk ke group bisnis (semua tim lihat).
- **Error tolerance** — failure di module tidak abort caller.
- **Threshold transparan** — angka di kode (bukan env) sehingga
  reviewable di code review.

## Non-goals

- **Tidak ada self-healing action** — hanya alert; action manual /
  optimizer.
- **Tidak adaptive threshold** — fixed 50% / 200% / 2h. Tidak belajar
  dari history pattern.
- **Tidak handle ad-set / ad level** — campaign-level only.
- **Tidak ada DM owner mode** — push ke group fixed (selaras dengan
  rewire `notifyOwner`).
- **Tidak menyimpan history alert** selain timestamp dedupe — `alert_dedupe`
  hanya `alertKey + lastSentAt`.

## Success Metrics

- **Time-to-alert p95 < 1 jam** dari kondisi anomali muncul ke alert
  di group (asumsi optimizer cron 3-jam jalan, plus polling Meta yang
  match dengan jam evaluasi).
- **False positive rate < 30%** — alert yang ke-fire ternyata bukan
  anomali sungguhan (validasi reviewer mingguan).
- **Spam suppression** — 0 alert duplicate dalam 6 jam window.
- **Module reliability** — failure di sini tidak menyebabkan optimizer
  abort (design tolerant).
- **Coverage** — semua connection aktif di-evaluasi tiap optimizer
  cycle (3-jam).
