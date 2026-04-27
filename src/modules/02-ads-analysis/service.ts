import { z } from 'zod';
import { logger } from '../00-foundation/index.js';
import {
  dateRangeSchema,
  targetSchema,
  recommendationThresholdsSchema,
  type DateRange,
  type Target,
  type PerformanceSummary,
} from './schema.js';
import { fetchInsights, type RawInsightRow } from './meta-insights.js';
import {
  summarize,
  rankPerformers,
  type TargetSummary,
  type PerformerRanking,
  type RankingOptions,
} from './metrics.js';
import {
  generateRecommendations,
  type Recommendation,
  type RecommendationThresholds,
} from './recommendations.js';
import { compareSummaries, type ComparisonResult } from './compare.js';
import {
  findFreshSnapshot,
  saveSnapshot,
  extractRowsFromSnapshot,
} from './snapshot-store.js';
import type { MetaInsightSnapshot } from '../../db/schema/meta-insight-snapshots.js';

export const analysisInputSchema = z.object({
  connectionId: z.string().uuid(),
  targets: z.array(targetSchema).min(1),
  range: dateRangeSchema,
  thresholds: recommendationThresholdsSchema.optional(),
});
export type AnalysisInput = z.infer<typeof analysisInputSchema>;

export interface AnalysisResult {
  range: DateRange;
  perTarget: TargetSummary[];
  rollup: PerformanceSummary;
  ranking: PerformerRanking;
  recommendations: Recommendation[];
  snapshotIds: string[];
}

/**
 * Returns a fresh snapshot — uses cached row if within TTL, otherwise fetches
 * from Meta and persists a new snapshot. All Meta reads land in the snapshot
 * table; downstream code should never call fetchInsights directly.
 */
export async function getOrFetchSnapshot(
  connectionId: string,
  target: Target,
  range: DateRange,
): Promise<MetaInsightSnapshot> {
  const cached = await findFreshSnapshot(target, range);
  if (cached) {
    logger.debug(
      { target, range, snapshotId: cached.id },
      'Using cached insight snapshot',
    );
    return cached;
  }
  const fetched = await fetchInsights(connectionId, target, range);
  const summary = summarize(fetched.rows);
  return saveSnapshot(
    connectionId,
    target,
    range,
    { rows: fetched.rows, raw: fetched.raw },
    summary,
  );
}

export async function analyze(
  input: AnalysisInput,
  rankingOpts: RankingOptions = {},
): Promise<AnalysisResult> {
  const parsed = analysisInputSchema.parse(input);
  const snapshots = await Promise.all(
    parsed.targets.map((t) =>
      getOrFetchSnapshot(parsed.connectionId, t, parsed.range),
    ),
  );

  const perTarget: TargetSummary[] = snapshots.map((s) => ({
    target: { type: s.targetType, id: s.targetId },
    summary: s.summary as PerformanceSummary,
  }));

  const rollup = summarize(collectRows(snapshots));
  const ranking = rankPerformers(perTarget, rankingOpts);
  const recommendations = generateRecommendations(
    perTarget,
    parsed.thresholds as Partial<RecommendationThresholds> | undefined,
  );

  return {
    range: parsed.range,
    perTarget,
    rollup,
    ranking,
    recommendations,
    snapshotIds: snapshots.map((s) => s.id),
  };
}

export const compareInputSchema = z.object({
  connectionId: z.string().uuid(),
  targets: z.array(targetSchema).min(1),
  windowA: dateRangeSchema,
  windowB: dateRangeSchema,
  thresholds: recommendationThresholdsSchema.optional(),
});
export type CompareInput = z.infer<typeof compareInputSchema>;

export interface PerTargetComparison {
  target: Target;
  comparison: ComparisonResult | null;
}

export interface CompareResult {
  windowA: AnalysisResult;
  windowB: AnalysisResult;
  rollupComparison: ComparisonResult;
  perTargetComparisons: PerTargetComparison[];
}

export async function compare(input: CompareInput): Promise<CompareResult> {
  const parsed = compareInputSchema.parse(input);
  const [a, b] = await Promise.all([
    analyze({
      connectionId: parsed.connectionId,
      targets: parsed.targets,
      range: parsed.windowA,
      thresholds: parsed.thresholds,
    }),
    analyze({
      connectionId: parsed.connectionId,
      targets: parsed.targets,
      range: parsed.windowB,
      thresholds: parsed.thresholds,
    }),
  ]);

  const rollupComparison = compareSummaries(a.rollup, b.rollup);
  const perTargetComparisons: PerTargetComparison[] = parsed.targets.map((t) => {
    const ax = a.perTarget.find(
      (x) => x.target.id === t.id && x.target.type === t.type,
    );
    const bx = b.perTarget.find(
      (x) => x.target.id === t.id && x.target.type === t.type,
    );
    return {
      target: t,
      comparison: ax && bx ? compareSummaries(ax.summary, bx.summary) : null,
    };
  });

  return { windowA: a, windowB: b, rollupComparison, perTargetComparisons };
}

function collectRows(snapshots: MetaInsightSnapshot[]): RawInsightRow[] {
  const out: RawInsightRow[] = [];
  for (const s of snapshots) {
    out.push(...extractRowsFromSnapshot(s));
  }
  return out;
}
