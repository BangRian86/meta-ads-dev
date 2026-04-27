import type { RawInsightRow } from './meta-insights.js';
import type { PerformanceSummary, Target } from './schema.js';

const RESULT_PRIORITY = [
  'purchase',
  'omni_purchase',
  'lead',
  'complete_registration',
  'subscribe',
  'add_to_cart',
  'initiate_checkout',
  'link_click',
];

export function summarize(rows: RawInsightRow[]): PerformanceSummary {
  let spend = 0;
  let impressions = 0;
  let clicks = 0;
  let reach = 0;
  let frequencyAcc = 0;
  let frequencyCount = 0;
  const actionTotals = new Map<string, number>();

  for (const row of rows) {
    spend += num(row.spend);
    impressions += int(row.impressions);
    clicks += int(row.clicks);
    reach += int(row.reach);
    if (row.frequency != null) {
      frequencyAcc += num(row.frequency);
      frequencyCount += 1;
    }
    if (row.actions) {
      for (const a of row.actions) {
        actionTotals.set(
          a.action_type,
          (actionTotals.get(a.action_type) ?? 0) + int(a.value),
        );
      }
    }
  }

  const resultActionType = pickResultAction(actionTotals);
  const results = resultActionType
    ? actionTotals.get(resultActionType) ?? 0
    : 0;

  return {
    spend: round(spend, 2),
    impressions,
    clicks,
    reach,
    frequency: frequencyCount ? round(frequencyAcc / frequencyCount, 2) : 0,
    ctr: impressions > 0 ? round((clicks / impressions) * 100, 4) : 0,
    cpm: impressions > 0 ? round((spend / impressions) * 1000, 2) : 0,
    cpc: clicks > 0 ? round(spend / clicks, 2) : 0,
    results,
    cpr: results > 0 ? round(spend / results, 2) : 0,
    resultActionType,
  };
}

export interface TargetSummary {
  target: Target;
  summary: PerformanceSummary;
}

export interface PerformerRanking {
  topByCtr: TargetSummary[];
  bottomByCtr: TargetSummary[];
  topByCpc: TargetSummary[];
  highestSpend: TargetSummary[];
}

export interface RankingOptions {
  topN?: number;
  /** Min impressions to be eligible for top-by-CTR ranking. */
  minImpressionsForTop?: number;
  /** Min spend to be eligible for bottom-by-CTR ranking. */
  minSpendForBottom?: number;
}

export function rankPerformers(
  targets: TargetSummary[],
  opts: RankingOptions = {},
): PerformerRanking {
  const topN = opts.topN ?? 3;
  const minImpressions = opts.minImpressionsForTop ?? 1000;
  const minSpend = opts.minSpendForBottom ?? 1;

  const eligibleForTop = targets.filter(
    (t) => t.summary.impressions >= minImpressions,
  );
  const topByCtr = [...eligibleForTop]
    .sort((a, b) => b.summary.ctr - a.summary.ctr)
    .slice(0, topN);

  const eligibleForBottom = targets.filter((t) => t.summary.spend >= minSpend);
  const bottomByCtr = [...eligibleForBottom]
    .sort((a, b) => a.summary.ctr - b.summary.ctr)
    .slice(0, topN);

  const clicked = targets.filter((t) => t.summary.clicks > 0);
  const topByCpc = [...clicked]
    .sort((a, b) => a.summary.cpc - b.summary.cpc)
    .slice(0, topN);

  const highestSpend = [...targets]
    .sort((a, b) => b.summary.spend - a.summary.spend)
    .slice(0, topN);

  return { topByCtr, bottomByCtr, topByCpc, highestSpend };
}

function pickResultAction(totals: Map<string, number>): string | null {
  for (const t of RESULT_PRIORITY) {
    if ((totals.get(t) ?? 0) > 0) return t;
  }
  let best: { type: string; value: number } | null = null;
  for (const [type, value] of totals) {
    if (value > 0 && (!best || value > best.value)) {
      best = { type, value };
    }
  }
  return best?.type ?? null;
}

function num(v: string | number | undefined): number {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function int(v: string | number | undefined): number {
  return Math.trunc(num(v));
}

function round(n: number, places: number): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}
