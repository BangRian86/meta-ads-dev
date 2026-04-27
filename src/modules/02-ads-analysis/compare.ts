import type { PerformanceSummary } from './schema.js';

export type SummaryMetric = Exclude<keyof PerformanceSummary, 'resultActionType'>;

export interface SummaryDelta {
  metric: SummaryMetric;
  before: number;
  after: number;
  absolute: number;
  /** Percentage change vs. before. Null when before === 0. */
  pct: number | null;
  direction: 'up' | 'down' | 'flat';
}

const NUMERIC_METRICS: SummaryMetric[] = [
  'spend',
  'impressions',
  'clicks',
  'reach',
  'frequency',
  'ctr',
  'cpm',
  'cpc',
  'results',
  'cpr',
];

export interface ComparisonResult {
  before: PerformanceSummary;
  after: PerformanceSummary;
  deltas: SummaryDelta[];
}

export function compareSummaries(
  before: PerformanceSummary,
  after: PerformanceSummary,
): ComparisonResult {
  const deltas: SummaryDelta[] = NUMERIC_METRICS.map((m) => {
    const b = before[m];
    const a = after[m];
    const abs = a - b;
    const pct = b === 0 ? null : Math.round((abs / b) * 10000) / 100;
    let direction: 'up' | 'down' | 'flat' = 'flat';
    if (abs > 0) direction = 'up';
    else if (abs < 0) direction = 'down';
    return {
      metric: m,
      before: b,
      after: a,
      absolute: Math.round(abs * 100) / 100,
      pct,
      direction,
    };
  });
  return { before, after, deltas };
}
