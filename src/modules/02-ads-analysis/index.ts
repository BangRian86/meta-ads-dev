export {
  targetTypeSchema,
  dateRangeSchema,
  targetSchema,
  performanceSummarySchema,
  recommendationThresholdsSchema,
  type TargetType,
  type DateRange,
  type Target,
  type PerformanceSummary,
  type RecommendationThresholdsInput,
} from './schema.js';

export {
  fetchInsights,
  type ActionValue,
  type RawInsightRow,
  type InsightFetchResult,
} from './meta-insights.js';

export {
  summarize,
  rankPerformers,
  type TargetSummary,
  type PerformerRanking,
  type RankingOptions,
} from './metrics.js';

export {
  generateRecommendations,
  DEFAULT_THRESHOLDS,
  type Recommendation,
  type RecommendationSeverity,
  type RecommendationThresholds,
} from './recommendations.js';

export {
  compareSummaries,
  type ComparisonResult,
  type SummaryDelta,
  type SummaryMetric,
} from './compare.js';

export {
  findFreshSnapshot,
  saveSnapshot,
  extractRowsFromSnapshot,
  type SnapshotPayload,
} from './snapshot-store.js';

export {
  analyze,
  compare,
  getOrFetchSnapshot,
  analysisInputSchema,
  compareInputSchema,
  type AnalysisInput,
  type AnalysisResult,
  type CompareInput,
  type CompareResult,
  type PerTargetComparison,
} from './service.js';
