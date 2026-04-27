# Blueprint — 10-telegram-bot

## Tujuan
Antarmuka utama operator (DM owner + group bisnis) — Telegraf bot yang
expose ~30 slash command + AI free-text Q&A, plus channel notifikasi
outbound dari modul lain (optimizer, alert, dll).

## File & Fungsi

| File | Fungsi |
|------|--------|
| `bot.ts` | `startBot / stopBot / getRunningBot` — Telegraf instance singleton. Pasang `groupFilter` middleware sebelum `registerCommands`. |
| `commands.ts` | `registerCommands(bot)` — daftar slash command: `/accounts /status /report /top /worst /rules /usage /drafts /audiences /pending /sheets /progress /cs /cabang /roas /tiktok /alert /refresh_cs /sync /pause /resume /budget /rule_enable /rule_disable /create_audience /approve_1..3 /yes /no /closing /publish /generate /generate_umroh /video /video_umroh /video_image`. Plus free-text AI handler. |
| `auth.ts` | `isAllowedChat` (owner DM atau group), `isApprover` (whitelist `TELEGRAM_APPROVED_USER_IDS`), `rejectIfNotOwner`. |
| `group-filter.ts` | Middleware drop chat-noise di group; lolos kalau slash command, mention bot, atau short approval reply ("ya"/"tidak"). |
| `ai-handler.ts` | `answerQuestion / answerSheetsQuestion / detectCommandIntent / detectSheetsIntent` — Claude API + tool use, dengan SYSTEM_PROMPT konteks brand (Basmalah Travel + Aqiqah Express). Log ke `ai_usage_logs`. |
| `ai-context.ts` | `buildAdsContext / formatContextForPrompt` — assemble multi-account context (semua connection + campaign + brand classification + benchmark) untuk prompt AI. |
| `ai-pricing.ts` | `computeCostUsd / usdToIdrApprox` — pricing per 1M token Claude Sonnet/Haiku, multiplier cache. |
| `usage-report.ts` | `buildUsageReport / renderUsageReport` — agregasi token + USD per window (1d/7d/30d). |
| `notifications.ts` | `notifyOwner(message, opts)` + `escapeMd` — sender-only Telegraf untuk modul yang bukan bot (cron, optimizer). |
| `formatters.ts` | `fmtIdr / fmtPct / trim / renderRankingBlock / renderReportBlock / renderStatusBlock`. |
| `copy-fix-store.ts` | Manage 3-option copy fix variants (draft → approved). `approveOption(batchId, optionIndex)`, `listPendingBatches`. |
| `date-args.ts` | Parser arg tanggal command (`/report 7d`, `/report 2026-04-01..2026-04-26`). |
| `index.ts` | Barrel export `startBot / stopBot / notifyOwner / formatters / auth helpers`. |

## Dependensi

- **Modul lain (banyak):** `01-manage-campaigns`, `02-ads-analysis`,
  `03-start-stop-ads`, `04-budget-control`, `05-kie-image-generator`,
  `06-copywriting-lab`, `07-rules-management`, `08-video-generator`,
  `11-auto-optimizer`, `12-approval-queue`, `13-sheets-integration`,
  `14-meta-progress`, `15-closing-tracker`, `16-ad-publisher`,
  `30-sheets-reader`. Plus `lib/audit-logger`, `lib/logger`, `config/env`.
- **Tabel database:** `aiusage_logs` (write — token cost), `copy_variants`
  (CRUD via copy-fix), plus read tabel modul lain via mereka.
- **External API:** Telegram Bot API (Telegraf), Anthropic Claude API,
  Meta Graph API (lewat modul lain).

## Cara Penggunaan

```typescript
// src/index.ts (auto-start dari main)
import { startBot, stopBot } from './modules/10-telegram-bot/index.js';
await startBot();

// Outbound notification dari mana saja (optimizer, alert, dll)
import { notifyOwner } from './modules/10-telegram-bot/index.js';
await notifyOwner('Optimizer selesai: 3 ad pause, 2 budget naik');
```

User flow di Telegram:
- DM owner: bebas command + AI free-text.
- Group bisnis: cuma slash command, mention bot, atau "ya/tidak" approval.
- Approval-gated commands (sync, pause, budget, dll) butuh user ID di
  `TELEGRAM_APPROVED_USER_IDS`.

## Catatan Penting

- **Group filter HARUS dipasang sebelum registerCommands** — Telegraf
  middleware urutan-sensitif. Kalau dibalik, semua chat-noise akan
  diproses.
- **Approval-gated command** ditandai `wrap(handler, { approver: true })`.
  Non-approver yang panggil → ditolak.
- **AI handler 2 jalur:** `answerQuestion` (Meta context) dan
  `answerSheetsQuestion` (Sheets context). `detectCommandIntent` /
  `detectSheetsIntent` untuk routing free-text ke command yang tepat.
- **Cost tracking** — setiap call Claude tercatat ke `ai_usage_logs`
  via `computeCostUsd`. `/usage` command render report.
- **Sender-only Telegraf di `notifications.ts`** — modul cron-based
  (mis. optimizer) tidak boleh share `bot.ts` instance karena bot
  punya polling loop. `notifyOwner` lazy-create singleton sender.
- **Brand classification** di `ai-context.ts` — assemble konteks
  Basmalah Travel + Aqiqah Express (pusat/jatim/jabar/jogja) supaya
  AI bisa bedakan akun saat user tanya cross-account.
- **Approval reply pendek** — group filter melolos ("ya"/"tidak"/"variannya")
  agar approver bisa balas pending action tanpa mention bot.
