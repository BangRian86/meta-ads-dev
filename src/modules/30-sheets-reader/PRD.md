# PRD — 30-sheets-reader

## Problem yang Diselesaikan

`20-roas-alert` menghitung ROAS via Meta API spend × proportional
attribution dari Sheets revenue → angka tidak akurat (1 closing
mungkin sebenarnya dari kombinasi multi-channel, tapi attribution
membaginya proporsional tanpa basis yang benar). Tim sales lebih
percaya angka Sheet mereka sendiri daripada angka hasil rekonstruksi.
Modul ini menggantikan dengan baca **semua** dari Sheets — spend,
chat, closing, revenue, ROAS, CR%, CPR, CAC, SAC — sebagai single
source of truth.

## Fitur Tersedia

- **5 Telegram command:**
  - `/cs <name>` — performance per CS individu.
  - `/cabang <branch>` — agregat per cabang.
  - `/roas <business> <branch?> <range?>` — ROAS report.
  - `/tiktok <business> <branch>` — channel TikTok specific.
  - `/alert` — current threshold breach status (manual trigger).
- **Cron-driven alerts** — `evaluateAlertsForCron` daily.
- **Business + branch resolver** — Aqiqah (4 cabang) + Basmalah Travel
  (PUSAT only).
- **Configurable threshold via Sheets** — `ALERT_CONFIG` tab punya
  rows per business × branch × metric (ROAS/CR%/CPR/CAC/SAC) dengan
  kritis + warning + active flag. Operator bisa tweak threshold tanpa
  deploy.
- **Healthy = silent** — cron tidak push notif kalau semua metric ok
  (mengurangi noise channel group).
- **Sub-channel Meta/Google/TikTok** — REPORTING tab punya kolom
  per-channel, modul bisa filter.
- **Bahasa Indonesia output** — formatter dengan tone manusiawi.
- **AI context** — compact snapshot 7d + 30d untuk dipakai Claude
  saat user tanya free-text.

## Non-goals

- **Tidak menulis** ke Sheets — read-only scope.
- **Tidak ada attribution / re-calculation** dari Meta API — angka =
  apa yang ada di Sheets.
- **Tidak handle multi-currency** — IDR.
- **Tidak handle Sheet di luar 2 spreadsheet operator** —
  `BUSINESSES` constant fix.
- **Tidak proactively detect anomaly** — itu `17-anomaly-alerts`.
- **Tidak melakukan Meta action** — pure reporting.
- **Tidak ada custom report builder UI** — command argumen terbatas.

## Success Metrics

- **Trust score tim** — tim sales percaya angka modul ini (tidak
  ada lagi "kok beda dengan punyaku?" — divalidasi oleh feedback
  langsung).
- **Healthy silence** — cron daily tidak fire kalau semua hijau
  (mengurangi alert fatigue).
- **NO_DATA correctness** — 0 case "belum tercatat" yang salah render
  jadi "Rp 0" atau sebaliknya.
- **Latency p95 < 5 detik** untuk single command (sheets API + parse).
- **Threshold edit feedback loop < 5 menit** — operator update
  ALERT_CONFIG → cron next firing pakai value baru tanpa restart.
- **Cache cs perform refresh** — `/refresh_cs` invalidate, command
  selanjutnya pull data fresh.
