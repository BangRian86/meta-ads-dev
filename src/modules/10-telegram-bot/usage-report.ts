import { gte, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { aiUsageLogs } from '../../db/schema/ai-usage-logs.js';
import { usdToIdrApprox } from './ai-pricing.js';

export interface UsageWindow {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
}

/**
 * Sums usage across rows whose `created_at` is at or after the cutoff. The
 * `costUsd` numeric column is summed in SQL — we cast to text and parse back
 * to keep precision at the application boundary.
 */
async function sumSince(cutoff: Date): Promise<UsageWindow> {
  const [row] = await db
    .select({
      calls: sql<string>`count(*)`,
      input: sql<string>`coalesce(sum(${aiUsageLogs.inputTokens}), 0)`,
      output: sql<string>`coalesce(sum(${aiUsageLogs.outputTokens}), 0)`,
      cacheRead: sql<string>`coalesce(sum(${aiUsageLogs.cacheReadTokens}), 0)`,
      cacheCreation: sql<string>`coalesce(sum(${aiUsageLogs.cacheCreationTokens}), 0)`,
      cost: sql<string>`coalesce(sum(${aiUsageLogs.costUsd}), 0)`,
    })
    .from(aiUsageLogs)
    .where(gte(aiUsageLogs.createdAt, cutoff));
  if (!row) {
    return zeroWindow();
  }
  return {
    calls: Number(row.calls ?? 0),
    inputTokens: Number(row.input ?? 0),
    outputTokens: Number(row.output ?? 0),
    cacheReadTokens: Number(row.cacheRead ?? 0),
    cacheCreationTokens: Number(row.cacheCreation ?? 0),
    costUsd: Number(row.cost ?? 0),
  };
}

function zeroWindow(): UsageWindow {
  return {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    costUsd: 0,
  };
}

export interface UsageReport {
  today: UsageWindow;
  thisMonth: UsageWindow;
  /** UTC start of "today" used for the today bucket. */
  todayStartUtc: string;
  /** UTC start of "this month" used for the month bucket. */
  monthStartUtc: string;
}

export async function buildUsageReport(): Promise<UsageReport> {
  const now = new Date();
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [today, thisMonth] = await Promise.all([
    sumSince(todayStart),
    sumSince(monthStart),
  ]);
  return {
    today,
    thisMonth,
    todayStartUtc: todayStart.toISOString(),
    monthStartUtc: monthStart.toISOString(),
  };
}

export function renderUsageReport(r: UsageReport): string {
  const lines: string[] = [];
  lines.push('💸 AI usage — Anthropic API');
  lines.push('');
  lines.push(formatWindow('Hari ini (UTC)', r.today, r.todayStartUtc));
  lines.push('');
  lines.push(formatWindow('Bulan ini (UTC)', r.thisMonth, r.monthStartUtc));
  lines.push('');
  lines.push('Estimasi billing — angka resmi ada di console.anthropic.com.');
  return lines.join('\n');
}

function formatWindow(label: string, w: UsageWindow, sinceIso: string): string {
  const usd = w.costUsd.toFixed(4);
  const idr = usdToIdrApprox(w.costUsd).toLocaleString('id-ID');
  return (
    `${label} — sejak ${sinceIso.slice(0, 16).replace('T', ' ')}\n` +
    `  Calls: ${w.calls}\n` +
    `  Input: ${fmtTokens(w.inputTokens)} | Output: ${fmtTokens(w.outputTokens)}\n` +
    `  Cache read: ${fmtTokens(w.cacheReadTokens)} | Cache write: ${fmtTokens(w.cacheCreationTokens)}\n` +
    `  Cost: $${usd}  (≈ Rp ${idr})`
  );
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
