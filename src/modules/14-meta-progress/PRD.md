# PRD — 14-meta-progress

## Problem yang Diselesaikan

Owner butuh "ringkasan kondisi semua campaign" 3x sehari di Telegram —
bukan dashboard yang harus dibuka. Tanpa modul ini, owner harus tanya
manual "berapa spend hari ini?" terus-menerus, atau lihat 5 ad
account satu-satu di Meta. Modul auto-generate laporan terstruktur
dengan emoji ✅/⚠️ supaya cepat di-scan.

## Fitur Tersedia

- **3x daily progress report** — 11:00 / 16:00 / 21:00 WIB.
- **Per-account section** — semua connection aktif.
- **Per-bucket grouping** — leads (top), traffic (mid), awareness (bottom).
- **Per-campaign line** — name + spend + results + CPR/CPC + emoji.
- **Brand-aware benchmark** — basmalah vs aqiqah pakai threshold beda.
- **Channel-aware benchmark** — leads_wa, leads_lp, traffic_lp,
  traffic_wa, awareness, sales — masing-masing punya threshold sendiri.
- **Auto detect** brand from name + channel from objective +
  destination_type.
- **Bahasa Indonesia** — format IDR (Rp 1.234.567), bulan
  (Jan/Feb/Mar/Apr/Mei/Jun/Jul/Agu/Sep/Okt/Nov/Des).

## Non-goals

- **Tidak menentukan threshold sendiri** — pakai `BENCHMARKS` constant
  dari playbook operator.
- **Tidak handle ad-set / ad level** — campaign-level summary saja.
- **Tidak menyimpan history** — setiap run regenerate dari snapshot
  + insights terbaru.
- **Tidak handle multi-bahasa** — Indonesian only.
- **Tidak ada UI configurable** — schedule fixed cron, threshold di
  code.
- **Tidak hitung ROAS** dari Sheets — itu domain `30-sheets-reader` /
  `20-roas-alert`.

## Success Metrics

- **Delivery reliability** — 3 cron firing × tiap hari = 3 bubble
  sukses kirim ≥ 99% hari.
- **Latency p95 < 30 detik** untuk seluruh report (5 connection × ~10
  campaign × analyze call).
- **Brand detection accuracy ≥ 95%** — name pattern recognition
  benar.
- **Emoji sanity** — campaign yang spend 0 / result 0 tidak salah
  flag (✅ palsu).
- **Header label tidak drift** — `--utc-hour` arg memastikan label
  jam = jam cron firing meski eksekusi telat beberapa detik.
