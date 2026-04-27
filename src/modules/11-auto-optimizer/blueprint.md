# Blueprint — 11-auto-optimizer

## Tujuan
Cron-driven auto-optimizer: tiap 3 jam evaluasi semua campaign aktif,
generate decisions (auto_pause / auto_scale / resume_notify /
cpr_alert / copy_fix_suggestion), eksekusi atau notify-only sesuai
policy. Plus utilitas pembuatan custom audience (engagement +
lookalike).

## File & Fungsi

| File | Fungsi |
|------|--------|
| `schema.ts` | `DecisionKind` (auto_pause / auto_scale / resume_notify / cpr_alert / copy_fix_suggestion), `OptimizerDecision`, `OptimizerExecutionResult`, `optimizerRunInputSchema` (connectionId, dryRun, notifyOnly), audience input schemas. |
| `evaluator.ts` | `evaluate(connectionId)` — load active + recently-paused campaigns, panggil `02-ads-analysis/analyze` per campaign, hitung CPR/CTR/spend/age, return decisions. Read-only. |
| `executor.ts` | `executeDecision(connection, decision, opts)` — translate decision ke action: pause via `03-start-stop-ads`, scale budget via `04-budget-control`, generate copy fix via `06-copywriting-lab/ai-generator`, enqueue ke `12-approval-queue` kalau butuh approval, notify ke `10-telegram-bot`. |
| `audience-creator.ts` | `createEngagementAudience` (IG/FB engagers, retention 30/60/90 hari), `createLookalike` (per-ratio audience, 1%–10%), `createMultiSourceEngagementAudience` (gabung IG + FB page dari `meta_connections.page_id` / `ig_business_id`), `listMetaAudiences` (read-only Graph API). |
| `runner.ts` | `runOptimizer(input)` — orkestrasi: evaluate → executeDecision per decision → aggregate `RunSummary`. Trigger juga `17-anomaly-alerts/detectAndNotifyAnomalies`. Token invalid → abort + 1 notify (bukan spam). |
| `index.ts` | Barrel export. |

## Dependensi

- **Modul lain:** `02-ads-analysis` (analyze), `03-start-stop-ads`
  (pause), `04-budget-control` (increase/decrease budget),
  `06-copywriting-lab` (generateAiVariantsForBadAd),
  `10-telegram-bot/notifications` (notifyOwner),
  `12-approval-queue` (enqueue), `14-meta-progress` (detectBrand),
  `17-anomaly-alerts` (detectAndNotifyAnomalies),
  `lib/auth-manager` (TokenInvalidError), `lib/audit-logger`, `lib/logger`, `config/env`.
- **Tabel database:** `meta_object_snapshots` (read), `meta_connections`
  (read), `copy_variants` (write — copy fix bundle), `meta_request_logs`
  (write — Meta calls), `operation_audits` (write).
- **External API:** Meta Graph API (audience create + insights via 02).

## Cara Penggunaan

```typescript
import { runOptimizer } from '../11-auto-optimizer/index.js';

// Cron entry-point: scripts/run-optimizer.ts
const summary = await runOptimizer({
  connectionId: 'uuid',
  dryRun: false,
  notifyOnly: false,
});
console.log(summary);
// { evaluated, decisions, executed, notifiedOnly, skipped, failed, results }

// Audience helper (dipakai dari Telegram /create_audience)
import { createMultiSourceEngagementAudience } from '../11-auto-optimizer/index.js';
await createMultiSourceEngagementAudience({
  connectionId,
  retentionDays: 60,
  name: 'Engager 60d — Aqiqah',
});
```

## Catatan Penting

- **Cron driver di `/etc/cron.d/maa-optimizer`** — `0 */3 * * *` →
  `/usr/local/bin/maa-optimizer` → `scripts/run-optimizer.ts`.
- **Decision kinds:**
  - `auto_pause` — spend besar tanpa hasil → pause langsung (atau queue
    kalau butuh approval).
  - `auto_scale` — performance bagus → naikkan budget (cap +20% via
    `04-budget-control`).
  - `resume_notify` — campaign baru di-pause tapi metric improving →
    suggest resume (notify only, manual approve).
  - `cpr_alert` — CPR > threshold → alert tanpa action.
  - `copy_fix_suggestion` — bad CTR di ad → generate 3 varian copy
    via Claude → simpan ke `copy_variants` source_tag=`copy_fix_suggestion`,
    notify owner untuk pilih `/approve_1..3`.
- **DryRun + notifyOnly mode** — bisa "lihat saja" tanpa eksekusi
  (untuk testing rule baru).
- **Token invalid → fail fast** — `TokenInvalidError` → modul abort,
  1 notify ke owner ("ad account X token invalid"). Tidak spam per
  campaign.
- **Audience helpers terpisah dari decision flow** — `createEngagementAudience`
  / `createLookalike` /
  `createMultiSourceEngagementAudience` dipanggil eksplisit (dari
  Telegram bot), bukan otomatis dari runner.
- **Multi-source engagement** baca `meta_connections.page_id` +
  `ig_business_id` per ad account → audience kombinasi 2 source.
