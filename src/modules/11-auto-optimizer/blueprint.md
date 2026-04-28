# Blueprint — 11-auto-optimizer

## Tujuan
Cron-driven auto-optimizer: tiap 3 jam evaluasi semua campaign aktif,
generate decisions (auto_pause / auto_scale / resume_notify /
cpr_alert / copy_fix_suggestion), eksekusi atau notify-only sesuai
policy.

> **Refactor April 2026:** `audience-creator.ts` dipindah ke modul
> sendiri `18-audience-builder/` untuk break circular dependency
> 11↔12 (approval-queue executor butuh audience builder, optimizer
> butuh approval-queue). Caller import audience helpers dari
> `18-audience-builder` — bukan dari sini.

## File & Fungsi

| File | Fungsi |
|------|--------|
| `schema.ts` | `DecisionKind` (auto_pause / auto_scale / resume_notify / cpr_alert / copy_fix_suggestion), `OptimizerDecision`, `OptimizerExecutionResult`, `optimizerRunInputSchema` (connectionId, dryRun, notifyOnly), audience input schemas. |
| `evaluator.ts` | `evaluate(connectionId)` — load active + recently-paused campaigns, panggil `02-ads-analysis/analyze` per campaign, hitung CPR/CTR/spend/age, return decisions. Read-only. |
| `executor.ts` | `executeDecision(connection, decision, opts)` — translate decision ke action: pause via `03-start-stop-ads`, scale budget via `04-budget-control`, generate copy fix via `06-copywriting-lab/ai-generator`, enqueue ke `12-approval-queue` kalau butuh approval, notify ke `00-foundation/notifications`. |
| `runner.ts` | `runOptimizer(input)` — orkestrasi: evaluate → executeDecision per decision → aggregate `RunSummary`. Trigger juga `17-anomaly-alerts/detectAndNotifyAnomalies`. Token invalid → abort + 1 notify (bukan spam). |
| `index.ts` | Barrel export. |

## Dependensi

- **Modul lain:** `00-foundation` (db, logger, appConfig,
  TokenInvalidError, recordAudit, notifyOwner), `02-ads-analysis`
  (analyze), `03-start-stop-ads` (pause), `04-budget-control`
  (increase/decrease budget), `06-copywriting-lab`
  (generateAiVariantsForBadAd), `12-approval-queue` (enqueue),
  `14-meta-progress` (detectBrand re-exported via foundation types),
  `17-anomaly-alerts` (detectAndNotifyAnomalies).
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

// Audience helper sekarang di modul terpisah (lihat 18-audience-builder).
// import { createMultiSourceEngagementAudience } from '../18-audience-builder/index.js';
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
- **Audience helpers terpisah** — sebelumnya inline di sini sebagai
  `audience-creator.ts`. Per April 2026 dipindah ke modul
  `18-audience-builder/`. Optimizer tidak panggil audience helper
  langsung; caller (Telegram `/create_audience`, approval-queue
  executor, dashboard `/audiences`) import dari modul 18.
