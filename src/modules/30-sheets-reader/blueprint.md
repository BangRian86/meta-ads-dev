# Blueprint — 30-sheets-reader

## Tujuan
Pengganti `20-roas-alert` (Tahap 2). Modul yang membaca **semua** data
operasional 100% dari Google Sheets — *-REPORTING tab + CS PERFORM tab
+ ALERT_CONFIG tab — tanpa proportional attribution. Expose 5
Telegram command (`/cs /cabang /roas /tiktok /alert`) + cron
evaluator.

## File & Fungsi

| File | Fungsi |
|------|--------|
| `business-resolver.ts` | `BUSINESSES` constant: Aqiqah Express (4 branch — PUSAT/JABAR/JATIM/JOGJA) + Basmalah Travel (PUSAT). `parseBusiness / parseBranch / resolveBranch(business, branch)` map user input ke `BusinessSheet`. |
| `sheets-client.ts` | `getReadClient()` — singleton Google Sheets v4 client, scope `spreadsheets.readonly`. Sengaja tidak ada write client (least privilege). |
| `cell-utils.ts` | `NO_DATA` symbol, `parseCellNumber / parseCellString`, `sheetsSerialToIsoDate`, `wibIsoDate`, `isNoData`. Bedakan `NO_DATA` ("kosong/—/N/A") vs `0` (data legitimate). |
| `reporting-data.ts` | `readReportingForBranch / filterByRange` — read tab *-REPORTING (header row 1, sub-label row 2, data row 3+). Kolom: A tgl, B ATC IKLAN (Meta), C Google Ads, D TikTok, F real chat masuk Meta, dst. `ReportingRow / ReportingAggregate / TiktokAggregate`. |
| `cs-data.ts` | `loadAllCsPerform / aggregateCsForRange / clearCsCache / findCsByName / rankAllCsForRange` — read tab "CS PERFORM" (kolom A tanggal, B head/provinsi, C nama CS, D chat, E closing, F ekor/keberangkatan, G revenue, H biaya/CS, I CAC, J SAC). |
| `alert-config.ts` | `loadAllAlertConfigs()` — read tab ALERT_CONFIG. `AlertConfigRow` { business, branch (atau '*'), metric (ROAS/CR%/CPR/CAC/SAC), kritis, warning, active }. |
| `commands.ts` | Handler 5 Telegram command + cron entry: `handleCsCommand` (`/cs`), `handleCabangCommand` (`/cabang`), `handleRoasCommand` (`/roas`), `handleTiktokCommand` (`/tiktok`), `handleAlertCommand` (`/alert`), `handleRefreshCs` (`/refresh_cs`), `evaluateAlertsForCron` (cron entry untuk `maa-sheets-alerts` + `maa-sheets-daily`). |
| `formatter.ts` | `fmtIdr / fmtRoas / fmtPct` (NO_DATA → "belum tercatat"), render block per command. Tone Indonesian. |
| `ai-context.ts` | `buildSheetsAiContext` — compact text snapshot Sheets data (per cabang × per channel × 7d + 30d aggregate) untuk Claude. Cap 30 hari window. |
| `index.ts` | Barrel export 5 command handler + cron entry + business resolver. |

## Dependensi

- **Modul lain:** `00-foundation` (db, logger, appConfig — meskipun
  module ini read-only ke Sheets, butuh foundation utility),
  `10-telegram-bot/date-args` (parseDateRange).
- **Tabel database:** none (read-only ke Google Sheets).
- **External API:** Google Sheets API v4 (read-only).

## Cara Penggunaan

```typescript
import {
  handleCsCommand,
  handleAlertCommand,
  evaluateAlertsForCron,
  parseBusiness,
  resolveBranch,
} from '../30-sheets-reader/index.js';

// Telegram bot register
bot.command('cs', wrap(handleCsCommand));
bot.command('alert', wrap(handleAlertCommand));

// Cron entry (scripts/send-sheets-alerts.ts)
const text = await evaluateAlertsForCron({ window: 'daily' });
if (text) await notifyOwner(text);
```

## Catatan Penting

- **Source of truth = Sheets** — tidak ada hitungan turunan dari Meta
  API. Spend/closing/revenue semua dari kolom-kolom Sheets.
- **`NO_DATA` ≠ `0`** — kolom kosong/strip → "belum tercatat", bukan
  "Rp 0". Filosofi: jangan misleading user kalau data belum di-input.
- **Layout REPORTING:** header row 1, sub-label row 2 (channel
  Meta/Google/TikTok), data row 3+. Modul tahu offset ini per kolom.
- **Layout CS PERFORM:** header row 1, data row 2+. 10 kolom A-J.
- **`ALERT_CONFIG` tab** drive cron alert — operator bisa tweak
  threshold tanpa deploy code (admin via Sheet langsung).
- **Service account least-privilege** — read-only scope. Tidak ada
  `getWriteClient()` by design; kalau butuh write nanti, tambah
  helper baru supaya audit-able.
- **Cache CS perform** — `loadAllCsPerform` cache di memory, `/refresh_cs`
  invalidate.
- **AI context cap 30d** — `buildSheetsAiContext` aggregate per-CS
  supaya prompt tidak meledak.
- **Cron driver:** `/etc/cron.d/maa-sheets-alerts` (00:00 UTC = 07:00
  WIB) + `/etc/cron.d/maa-sheets-daily` (02:00 UTC = 09:00 WIB).
