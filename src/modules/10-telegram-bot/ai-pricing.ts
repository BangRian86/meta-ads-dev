/**
 * Anthropic API pricing (USD per 1M tokens). Anthropic publishes per-model
 * pricing; we hard-code the models we actually call. Cache rates follow the
 * standard multipliers: write 5min = 1.25×, write 1h = 2×, read = 0.1×.
 */

export interface ModelPricing {
  /** Standard input tokens. */
  input: number;
  /** Output tokens. */
  output: number;
  /** Cache-write tokens (default 5min TTL — what our caching uses). */
  cacheWrite5m: number;
  /** Cache-read tokens. */
  cacheRead: number;
}

const PRICING_PER_1M: Record<string, ModelPricing> = {
  'claude-sonnet-4-20250514': {
    input: 3.0,
    output: 15.0,
    cacheWrite5m: 3.75,
    cacheRead: 0.3,
  },
  'claude-sonnet-4-5-20251022': {
    input: 3.0,
    output: 15.0,
    cacheWrite5m: 3.75,
    cacheRead: 0.3,
  },
  'claude-sonnet-4-5-20250929': {
    input: 3.0,
    output: 15.0,
    cacheWrite5m: 3.75,
    cacheRead: 0.3,
  },
  'claude-sonnet-4-0': {
    input: 3.0,
    output: 15.0,
    cacheWrite5m: 3.75,
    cacheRead: 0.3,
  },
  'claude-sonnet-4-5': {
    input: 3.0,
    output: 15.0,
    cacheWrite5m: 3.75,
    cacheRead: 0.3,
  },
  'claude-sonnet-4-6': {
    input: 3.0,
    output: 15.0,
    cacheWrite5m: 3.75,
    cacheRead: 0.3,
  },
  'claude-opus-4-7': {
    input: 5.0,
    output: 25.0,
    cacheWrite5m: 6.25,
    cacheRead: 0.5,
  },
  'claude-opus-4-6': {
    input: 5.0,
    output: 25.0,
    cacheWrite5m: 6.25,
    cacheRead: 0.5,
  },
  'claude-opus-4-5': {
    input: 5.0,
    output: 25.0,
    cacheWrite5m: 6.25,
    cacheRead: 0.5,
  },
  'claude-opus-4-5-20251101': {
    input: 5.0,
    output: 25.0,
    cacheWrite5m: 6.25,
    cacheRead: 0.5,
  },
  'claude-haiku-4-5': {
    input: 1.0,
    output: 5.0,
    cacheWrite5m: 1.25,
    cacheRead: 0.1,
  },
  'claude-haiku-4-5-20251001': {
    input: 1.0,
    output: 5.0,
    cacheWrite5m: 1.25,
    cacheRead: 0.1,
  },
};

/** Falls back to Sonnet 4.x tier for unknown models — middle of the price tiers
 *  so unknown-model cost is never silently zero and not wildly off either way. */
export function pricingFor(model: string): ModelPricing {
  return PRICING_PER_1M[model] ?? PRICING_PER_1M['claude-sonnet-4-6']!;
}

export interface UsageBreakdown {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export function computeCostUsd(model: string, usage: UsageBreakdown): number {
  const p = pricingFor(model);
  const cost =
    (usage.inputTokens * p.input) / 1_000_000 +
    (usage.outputTokens * p.output) / 1_000_000 +
    (usage.cacheCreationTokens * p.cacheWrite5m) / 1_000_000 +
    (usage.cacheReadTokens * p.cacheRead) / 1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000; // round to 6 decimals
}

/** Approx IDR conversion for display only — not authoritative billing. */
export function usdToIdrApprox(usd: number, rate = 16500): number {
  return Math.round(usd * rate);
}
