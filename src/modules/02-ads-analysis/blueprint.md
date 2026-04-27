# Blueprint — 02-ads-analysis

## Tujuan
Menarik insight performance dari Meta, menormalkan ke
`PerformanceSummary`, menyimpan snapshot ber-TTL, dan menghasilkan
rekomendasi + perbandingan periode untuk dipakai modul lain
(optimizer, telegram bot, dashboard).

## File & Fungsi

| File | Fungsi |
|------|--------|
| `schema.ts` | Zod schemas: `targetSchema`, `dateRangeSchema`, `performanceSummarySchema`, `recommendationThresholdsSchema`. |
| `meta-insights.ts` | `fetchInsights` — Graph API `/insights` reader; field map (spend, impressions, clicks, ctr, cpm, cpc, reach, frequency, actions). Log ke `meta_request_logs`. |
| `metrics.ts` | `summarize` (rows → PerformanceSummary, pilih result action prioritas: purchase → lead → ATC → link_click), `rankPerformers`. |
| `recommendations.ts` | `generateRecommendations` + `DEFAULT_THRESHOLDS` (lowCtrPct=1.0, highCtrPct=3.0, significantSpend=50, highFrequency=3.0, zeroResultSpend=25). Severity: critical/warning/info. |
| `compare.ts` | `compareSummaries` — delta absolute + percentage per metric, direction up/down/flat. |
| `snapshot-store.ts` | `findFreshSnapshot / saveSnapshot / extractRowsFromSnapshot` ke `meta_insight_snapshots`. TTL via `config.insightSnapshotTtlMs`. |
| `service.ts` | Public facade: `analyze`, `compare`, `getOrFetchSnapshot`. Cache-aside via snapshot store. |
| `index.ts` | Barrel export. |

## Dependensi

- **Modul lain:** `lib/auth-manager` (TokenInvalidError, requireActiveConnection),
  `lib/error-mapper`, `config/env` (insightSnapshotTtlMs), `lib/logger`.
- **Tabel database:** `meta_insight_snapshots` (read+write),
  `meta_request_logs` (write), `meta_connections` (read).
- **External API:** Meta Graph API
  `/{target_id}/insights?fields=spend,impressions,clicks,ctr,cpm,cpc,reach,frequency,actions,cost_per_action_type,...`.

## Cara Penggunaan

```typescript
import { analyze, compare } from '../02-ads-analysis/index.js';

// Single target dengan rekomendasi
const r = await analyze({
  connectionId,
  target: { type: 'campaign', id: '123' },
  range: { since: '2026-04-01', until: '2026-04-26' },
});
console.log(r.summary, r.recommendations);

// Compare 2 periode
const cmp = await compare({
  connectionId,
  target: { type: 'adset', id: '456' },
  before: { since: '2026-04-01', until: '2026-04-13' },
  after:  { since: '2026-04-14', until: '2026-04-26' },
});
```

## Catatan Penting

- **Cache-aside via snapshot** — `getOrFetchSnapshot` cek
  `meta_insight_snapshots` dulu (TTL `insightSnapshotTtlMs`); kalau
  fresh, skip Graph API call. Save snapshot kalau hit Meta.
- **Result metric heuristic** — `summarize` pilih action_type pertama
  yang punya value > 0 dari priority list (purchase, lead, ATC, dst).
  Hasil disimpan di `summary.resultActionType` untuk transparansi.
- **Threshold rekomendasi opsional** — caller bisa override
  `DEFAULT_THRESHOLDS` per call (mis. khusus akun yang CPR-nya beda).
- **Frequency averaging** — di `summarize`, rata-rata bobot dari row
  yang punya nilai frequency saja (tidak semua insight row punya).
- **Tidak meng-eksekusi action** — modul ini hanya RECOMMEND. Eksekusi
  ada di `03-start-stop-ads`, `04-budget-control`, `12-approval-queue`.
