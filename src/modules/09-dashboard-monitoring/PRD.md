# PRD — 09-dashboard-monitoring

## Problem yang Diselesaikan

Tim butuh window read-mostly untuk memantau kondisi sistem (token
masih valid? cron jalan? berapa asset in-flight? campaign apa yang
sedang sync?), dan satu tempat untuk admin secret rotation (Meta token,
KIE key) tanpa harus SSH ke server. Tanpa modul ini, debugging via
psql + tail log = lambat dan rawan typo.

## Fitur Tersedia

- **Auth** — username/password form + signed cookie session.
- **Home** — activity overview (operations 24h success/failed, API
  calls 1h, in-flight images), tabel ad account + KIE key + recent
  audit.
- **Campaigns** — list dari snapshot, drill-down ke adsets + ads.
- **Creative library** — image preview inline, video player, download,
  filter (type/status/akun), pagination 20 per halaman, metadata
  (prompt, model, ukuran, expiry).
- **Audience manager** — live fetch custom + lookalike audience dari
  Meta untuk semua connection aktif, filter per akun, error per-akun
  ditampilkan tanpa block akun lain.
- **Workflow explorer** — visualisasi flow Sync → Analyze → Optimize →
  Notify → Approve → Execute + tabel cron jobs (`maa-*`) dengan
  schedule + last run time.
- **Settings** — add/replace/rename Meta connection, add/replace KIE key.
- **Mobile-friendly** — nav collapsible, tabel scroll horizontal, font
  readable di mobile.
- **Breadcrumbs** di setiap halaman.

## Non-goals

- **Bukan tool create campaign / iklan dari UI** — admin via Telegram
  bot atau langsung Meta Ads Manager.
- **Bukan analytics tool full-featured** — angka high-level saja;
  analisis dalam pakai Sheets dashboard atau Telegram bot.
- **Tidak ada role / permission granular** — single user (`DASHBOARD_USERNAME`).
- **Tidak ada streaming / websocket** — refresh manual (polling browser).
- **Tidak menampilkan secret value** — token/API key di-mask via
  `maskSecret()` (8 dots + last 4 chars).
- **Tidak ada light/dark theme toggle** — single theme.

## Success Metrics

- **Login latency p95 < 500 ms** (1 DB query + HMAC verify).
- **Home page load p95 < 2 detik** (parallelized 4 query).
- **`/audiences` graceful degradation** — kalau 1 connection error,
  9 connection lain tetap render.
- **Mobile usability** — semua page bisa dipakai di viewport 360px.
- **Audit visibility** — operasi yang dilakukan dari dashboard
  (replace token, dst) tercatat di `operation_audits`.
- **Asset preview reliability** — kalau URL asset masih valid (belum
  expired), thumbnail tampil > 95%.
