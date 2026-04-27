# TOOLS.md

Inventaris seluruh "tool" yang tersedia di repo `meta-ads-dev`:
wrapper `/usr/local/bin/maa-*` (cron entry-point), script di
`scripts/` (debugging + cron source), dan fungsi public utama per
modul (`src/modules/*/index.ts`).

> Update file ini setiap kali tambah/pindah/hapus tool. Audit blueprint
> mengandalkan TOOLS.md sebagai single source-of-truth jalur eksekusi.

---

## 1. Wrapper script (`/usr/local/bin/maa-*`)

Bash wrapper yang dipanggil cron `/etc/cron.d/maa-*`. Tiap wrapper
`cd /root/meta-ads-dev`, set `NODE_ENV=production`, lalu invoke `tsx`
dengan script di `scripts/`.

| Wrapper | Script source | Cron | Tujuan |
|---|---|---|---|
| `maa-optimizer` | `scripts/run-optimizer.ts` | `0 */3 * * *` | Sync + evaluate + apply auto-optimizer |
| `maa-meta-progress` | `scripts/send-meta-progress.ts` | `0 4,9,14 * * *` UTC | 3× progress report harian (Telegram) |
| `maa-sheets-alerts` | `scripts/send-sheets-alerts.ts` | `0 0 * * *` UTC | Daily alert dari Sheets ALERT_CONFIG |
| `maa-sheets-daily` | `scripts/send-daily-sheets-report.ts` | `0 2 * * *` UTC | Daily summary report Sheets |
| `maa-daily-summary` | `scripts/send-daily-summary.ts` | `0 0 * * *` UTC | Morning summary digest |

**Disabled (transition):**
- `maa-roas-alerts` — semua line cron di-comment 2026-04-26; dihapus
  bersama modul `20-roas-alert` (lihat changelog).

---

## 2. Script di `scripts/` (cron source + debug)

Cron entry-points (dipakai wrapper):

| Script | Dipakai oleh | Catatan |
|---|---|---|
| `run-optimizer.ts` | `maa-optimizer` | Loop semua connection → `runOptimizer` |
| `send-meta-progress.ts` | `maa-meta-progress` | Arg `--utc-hour=<n>` lock label |
| `send-sheets-alerts.ts` | `maa-sheets-alerts` | `evaluateAlertsForCron('daily')` |
| `send-daily-sheets-report.ts` | `maa-sheets-daily` | Daily Sheets summary |
| `send-daily-summary.ts` | `maa-daily-summary` | Morning digest |

Manual / debug script (tidak di-cron):

| Script | Tujuan |
|---|---|
| `sync-account.ts` | One-shot sync semua connection (manual) |
| `debug-alert-config.ts` | Dump ALERT_CONFIG sheet ke stdout |
| `debug-detection.ts` | Trace `detectCampaignType` per nama campaign |
| `discover-reporting-wide.ts` | Discover REPORTING tab columns |
| `discover-sheets.ts` | List spreadsheet tabs + headers |
| `list-tabs.ts` | List tab nama saja |
| `send-discovery-report.ts` | Discovery report ke Telegram |
| `test-alert-engine.ts` | Smoke test alert engine |
| `test-budget-read.ts` | Cek budget read Meta |
| `test-copy-fix.ts` | Smoke test copy_fix flow |
| `test-group-filter.ts` | Telegram group filter unit smoke |
| `test-roas-range.ts` | Smoke test ROAS per range (deprecated) |
| `test-roas-sheets.ts` | Smoke test Sheets-based ROAS |
| `test-sheets-reader.ts` | Smoke test 30-sheets-reader |

**Removed:** `send-roas-alerts.ts` — dihapus bersama `20-roas-alert`.

---

## 3. Fungsi public per modul

Public API modul. Selalu import lewat modul `index.ts`, bukan file
internal.

### 00-foundation
**Path:** `../00-foundation/index.js`

Direct re-exports: `db`, `schema`, `pingDb`, `closeDb`, `appConfig`,
`logger`, `recordAudit`, `withAudit`, `TokenInvalidError`,
`requireActiveConnection`, `markInvalid`, `mapMetaError`,
`mapHttpFailure`, `notifyOwner`, `escapeMd`, `computeCostUsd`,
`usdToIdrApprox`, `MODEL_PRICING`, `Brand`, `Channel`,
`MappedMetaError`.

Namespaces: `auth`, `audit`, `config`, `database`, `errorMapper`,
`providerClient`, `snapshotRepository`, `jobDispatcher`,
`notifications`, `pricing`, `types`.

### 01-manage-campaigns
`createCampaign / createAdSet / createAd / syncCampaign / syncObject`
(service), `syncCampaignHierarchy / syncSingleObject / syncAccount` (sync),
`duplicateObject` (duplicate), `preflightCampaign / AdSet / Ad`,
`PreflightFailedError`.

### 02-ads-analysis
`analyze / compare / getOrFetchSnapshot` (service),
`fetchInsights`, `summarize / rankPerformers`,
`generateRecommendations / DEFAULT_THRESHOLDS`,
`compareSummaries`, `findFreshSnapshot / saveSnapshot`.

### 03-start-stop-ads
`pause / unpause` (service), `setObjectStatus` (mutation),
`fetchObject` (read), `loadChain`, `deriveActivationBlockers`.

### 04-budget-control
`increaseBudget / decreaseBudget` (service),
`readBudget / writeBudget`, `detectBudgetOwner /
findFirstAdsetWithBudget`, `BudgetCapExceededError /
BudgetBelowMinError / BudgetTargetMismatchError /
NoBudgetConfiguredError`.

### 05-kie-image-generator
`submitGeneration / submitEdit / pollTask` (service),
`processCallback`, `pollAllInflight / markExpiredAssets`,
`generateImageForTelegram`, `ensureKieCredentialFromEnv`.

### 06-copywriting-lab
`createBrief / updateBrief / removeBrief`, `generate / createVariant /
review / reviewExternalCopy / setStatus / listForBrief` (service),
`generateAiVariantsForBadAd`, `parseBrief`.

### 07-rules-management
`createDraft / updateDraft / discardDraft / publishDraft`,
`updateRule / enableRule / disableRule / deleteRule`,
`refreshSnapshot / describeRule / listRules`, `formatRule`.

### 08-video-generator
Lihat `08-video-generator/blueprint.md`. Public: `submitVideo /
pollVideoTask / processVideoCallback`,
`generateVideoForTelegram`, `pollAllInflightVideos`.

### 09-dashboard-monitoring
`dashboardRoutes` (Fastify plugin), `readSession / requireAuth /
verifyCredentials`.

### 10-telegram-bot
`startBot / stopBot / getRunningBot`, formatters
`fmtIdr / fmtPct / trim / renderRankingBlock /
renderReportBlock / renderStatusBlock`, `isOwner /
rejectIfNotOwner`. `notifyOwner` + `escapeMd` di-export
sebagai re-export dari `00-foundation/notifications` (backward compat).

### 11-auto-optimizer
`runOptimizer` (runner), `evaluate` (evaluator),
`executeDecision` (executor). Audience helpers
(`createEngagementAudience` dll) **dipindah** ke 18-audience-builder.

### 12-approval-queue
`enqueue / listLivePending / findByShortId / findOnlyLivePending`,
`markApproved / Rejected / Executed / Failed`, `shortId`,
`formatConfirmation / formatPendingList / formatMultiPendingNudge`,
`executePending`.

### 13-sheets-integration
`readSheetData / parseShortDate`, `SHEET_SOURCES /
buildDailyReport / getReportForDate / getYesterdayReport`,
`getSheetsClient`, `getClosingRevenueForRange /
getClosingRevenueForAccount / matchSheetSourceForAccount /
unitForKind`.

### 14-meta-progress
`buildProgressBubbles / buildProgressData / wibHourLabel`,
`detectBrand / lookupBenchmark / statusEmoji`,
`classifyCampaign`. (Type `Brand` dipindah ke `00-foundation/types`,
masih di-re-export di sini untuk backward compat.)

### 15-closing-tracker
`recordClosing / buildRoasReport / buildRoasReportForRange /
buildCampaignRoasForRange / resolveConnectionByAlias`,
`formatRoasReport`.

### 16-ad-publisher
`enqueuePublishAd`, `executePublishAd`.

### 17-anomaly-alerts
`detectAndNotifyAnomalies`.

### 18-audience-builder
`createEngagementAudience / createLookalike /
createMultiSourceEngagementAudience / listMetaAudiences`.

### 30-sheets-reader
`handleCsCommand / handleCabangCommand / handleRoasCommand /
handleTiktokCommand / handleAlertCommand / handleRefreshCs /
evaluateAlertsForCron`, `BUSINESSES / parseBusiness / parseBranch /
resolveBranch`, `loadAllAlertConfigs`.

---

## 4. Konvensi import

```typescript
// ✅ Good — import via index.js modul
import { recordAudit, db, logger, notifyOwner } from '../00-foundation/index.js';
import { runOptimizer } from '../11-auto-optimizer/index.js';

// ❌ Bad — import internal file
import { recordAudit } from '../../lib/audit-logger.js';        // legacy, removed
import { withAudit } from '../00-foundation/audit.js';           // bypass barrel
import { runOptimizer } from '../11-auto-optimizer/runner.js';   // bypass barrel
```

`src/lib/*` (audit-logger, auth-manager, error-mapper, logger) **sudah
dihapus** — semua import wajib lewat `00-foundation/index.js`.
