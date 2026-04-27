import type { TargetSummary } from './metrics.js';
import type { Target } from './schema.js';

export type RecommendationSeverity = 'critical' | 'warning' | 'info';

export interface Recommendation {
  target: Target;
  severity: RecommendationSeverity;
  action: string;
  reason: string;
  metrics: Record<string, number>;
}

export interface RecommendationThresholds {
  lowCtrPct: number;
  highCtrPct: number;
  significantSpend: number;
  highFrequency: number;
  zeroResultSpend: number;
}

export const DEFAULT_THRESHOLDS: RecommendationThresholds = {
  lowCtrPct: 1.0,
  highCtrPct: 3.0,
  significantSpend: 50,
  highFrequency: 3.0,
  zeroResultSpend: 25,
};

export function generateRecommendations(
  targets: TargetSummary[],
  overrides: Partial<RecommendationThresholds> = {},
): Recommendation[] {
  const t: RecommendationThresholds = { ...DEFAULT_THRESHOLDS, ...overrides };
  const recs: Recommendation[] = [];

  for (const ts of targets) {
    const s = ts.summary;
    const target = ts.target;

    if (s.spend >= t.zeroResultSpend && s.results === 0) {
      recs.push({
        target,
        severity: 'critical',
        action: 'pause_or_redesign',
        reason: `Spent ${s.spend} with zero conversions (action_type=${
          s.resultActionType ?? 'n/a'
        })`,
        metrics: { spend: s.spend, results: s.results },
      });
      continue;
    }

    if (s.spend >= t.significantSpend && s.ctr < t.lowCtrPct) {
      recs.push({
        target,
        severity: 'warning',
        action: 'refresh_creative',
        reason: `CTR ${s.ctr}% below ${t.lowCtrPct}% on spend ${s.spend} — creative likely fatigued or off-audience`,
        metrics: { ctr: s.ctr, spend: s.spend },
      });
    }

    if (s.frequency >= t.highFrequency && s.impressions > 0) {
      recs.push({
        target,
        severity: 'warning',
        action: 'expand_audience',
        reason: `Frequency ${s.frequency} >= ${t.highFrequency} — audience saturated`,
        metrics: {
          frequency: s.frequency,
          reach: s.reach,
          impressions: s.impressions,
        },
      });
    }

    if (s.ctr >= t.highCtrPct && s.spend >= t.significantSpend / 2) {
      recs.push({
        target,
        severity: 'info',
        action: 'scale_budget',
        reason: `CTR ${s.ctr}% >= ${t.highCtrPct}% — strong creative, consider increasing budget`,
        metrics: { ctr: s.ctr, spend: s.spend, cpc: s.cpc },
      });
    }
  }

  return recs;
}
