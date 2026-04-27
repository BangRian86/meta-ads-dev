# PRD — 10-telegram-bot

## Problem yang Diselesaikan

Tim media buyer dan owner butuh kontrol terhadap iklan Meta dari HP,
realtime, di group bisnis. Web dashboard cocok untuk monitoring tapi
buruk untuk action cepat ("pause campaign Y", "naikkan budget X 10%",
"berapa ROAS hari ini?"). Telegram = always-on, push notification,
familiar. Modul ini menjadi the primary control surface.

## Fitur Tersedia

- **~30 slash command** — accounts, status, report, top, worst, rules,
  usage, drafts, audiences, pending, sheets, progress, cs, cabang,
  roas, tiktok, alert, sync, pause, resume, budget, rule_enable/disable,
  create_audience, approve_1..3, yes, no, closing, publish, generate,
  generate_umroh, video, video_umroh, video_image, refresh_cs.
- **AI free-text Q&A** — Claude API dengan context multi-account +
  brand classification (Basmalah Travel + Aqiqah Express).
- **Approval gating** — command destructive butuh user ID di
  `TELEGRAM_APPROVED_USER_IDS`.
- **Group filter** — di group, chat-noise di-drop; cuma slash command,
  mention bot, atau approval reply pendek yang lolos.
- **Outbound notifications** — `notifyOwner` untuk modul cron-based
  (optimizer, alert, anomaly).
- **Cost report** — `/usage` agregasi token Claude (1d / 7d / 30d) +
  estimasi rupiah.
- **Copy fix workflow** — bot kirim 3 option, approver pilih
  `/approve_1..3` → variant masuk approval queue / publish.
- **Image / video generation** — `/generate /video` invoke modul KIE.
- **Sheets integration** — query daily report dari Google Sheets.

## Non-goals

- **Bukan dashboard analytics dalam** — angka cepat, drill-down ke web
  dashboard atau Sheets.
- **Tidak handle multi-tenant** — single owner + 1 group.
- **Tidak ada inline mode / button keyboard rich** — pakai slash + reply.
- **Tidak ada language selection** — bahasa Indonesia, prompt AI
  dengan brand voice ID.
- **Tidak menyimpan history chat user** — log message ke logger saja.

## Success Metrics

- **Command latency p95 < 3 detik** untuk read commands (status,
  report, top).
- **AI answer latency p95 < 8 detik** (streaming Claude + context build).
- **Approval flow correctness** — 0 destructive command dieksekusi
  tanpa approver allowlist.
- **Group spam = 0** — chat-noise tidak men-trigger response.
- **Cost predictability** — `/usage` selalu sync dengan `ai_usage_logs`.
- **Uptime** — bot reconnect otomatis dari Telegram error transient
  (Telegraf default behavior).
