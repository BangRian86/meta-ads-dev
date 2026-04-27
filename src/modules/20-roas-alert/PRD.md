# PRD — 20-roas-alert

> ⚠️ **DEPRECATED 2026-04-26.** Pengganti: `30-sheets-reader`.
> Cron `/etc/cron.d/maa-roas-alerts` sudah di-disable. Modul masih
> di-export sebagai transition window untuk `/alerts` handler lama.

## Problem yang Diselesaikan

Sebelum deprecation: tim butuh signal otomatis "campaign mana yang
ROAS-nya di bawah threshold per stage funnel" tanpa harus buka Sheets
manual. Modul evaluasi per-campaign × per-window (daily/weekly/monthly)
dan kirim alert dengan tone yang manusiawi (template pool).

## Fitur Tersedia

- **Per-campaign ROAS evaluation** dengan threshold per Business +
  CampaignType.
- **3 window:** daily, weekly, monthly.
- **3 severity:** critical, warning, ok.
- **Funnel detection** dari nama campaign (BOFU/MOFU/TOFU/SALES + alias).
- **Tone-varied formatter** — formal-tegas / santai / netral
  profesional, random per output.
- **Min spend filter** — skip campaign dengan spend terlalu kecil.

## Non-goals

- **Tidak akurat (motif deprecation)** — proportional attribution
  spend × revenue tidak match real attribution. Sheets data adalah
  source of truth.
- **Tidak ada self-action** — alert only.
- **Tidak ada custom threshold per akun** — hardcoded di code.
- **Tidak handle multi-currency** — IDR only.

## Success Metrics

> ⚠️ Module deprecated. Success metrics di-replace oleh `30-sheets-reader`.
> Yang tersisa untuk transition:
- **0 cron firing** dari `/etc/cron.d/maa-roas-alerts` (semua line
  comment).
- **Backward-compat** — `/alerts` Telegram handler masih jalan
  selama window transisi.
- **Owner tahu deprecation** — module level docstring jelas, dengan
  pointer ke pengganti.
