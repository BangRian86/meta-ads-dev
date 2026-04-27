import { and, desc, eq } from 'drizzle-orm';
import { config } from '../../config/env.js';
import { db } from '../../db/index.js';
import { metaConnections } from '../../db/schema/meta-connections.js';
import {
  metaObjectSnapshots,
  type MetaObjectSnapshot,
} from '../../db/schema/meta-object-snapshots.js';
import { analyze, type DateRange, type Target } from '../02-ads-analysis/index.js';
import {
  detectBrand,
  lookupBenchmark,
  type Brand,
} from '../14-meta-progress/index.js';
import { classifyCampaign } from '../14-meta-progress/index.js';

export interface CampaignContextRow {
  id: string;
  name: string;
  status: string;
  effectiveStatus: string;
  objective: string | null;
  ageDays: number | null;
  spendIdr: number;
  results: number;
  cprIdr: number;
  ctrPct: number;
  impressions: number;
  clicks: number;
  resultActionType: string | null;
  /** Channel benchmark "cheap"/"expensive" untuk metric yang relevan
   *  (CPR untuk leads, CPC untuk traffic, CPM untuk awareness). Helper
   *  buat Claude judge "campaign ini mahal atau murah" tanpa hardcode
   *  threshold di prompt. */
  benchmarkLabel: string;
  benchmarkCheap: number;
  benchmarkExpensive: number;
  /** Budget harian aktual dari Meta dalam IDR (whole rupiah).
   *  CBO = budget di campaign level. ABO = sum daily_budget semua adset
   *  aktif. Null kalau belum ke-sync atau pakai lifetime_budget. */
  dailyBudgetIdr: number | null;
  /** "cbo" = campaign-budget-optimization (budget di campaign level),
   *  "abo" = ad-set-budget-optimization (budget per-adset). Null kalau
   *  belum bisa ditentukan dari snapshot. */
  budgetLevel: 'cbo' | 'abo' | null;
  /** True kalau campaign pakai lifetime_budget (bukan daily). Helper
   *  buat AI tahu kenapa dailyBudgetIdr null. */
  hasLifetimeBudget: boolean;
}

export interface AccountContext {
  name: string;
  adAccountId: string;
  /** Brand dari accountName — drives benchmark thresholds. */
  brand: Brand;
  active: CampaignContextRow[];
  recentlyPaused: CampaignContextRow[];
  totals: {
    activeSpendIdr: number;
    activeResults: number;
    avgCprIdr: number;
  };
}

export interface MultiAccountAdsContext {
  generatedAt: string;
  dateRange: DateRange;
  accounts: AccountContext[];
  grandTotals: {
    activeSpendIdr: number;
    activeResults: number;
    avgCprIdr: number;
    activeCampaigns: number;
  };
}

/**
 * Builds context across EVERY active connection. Used by the natural-language
 * Q&A handler so Claude can answer cross-account questions ("which account
 * has highest spend today?", "best CPR overall", etc.).
 *
 * Insight queries use module 02's snapshot store which respects
 * INSIGHT_SNAPSHOT_TTL_MIN — back-to-back questions reuse cached snapshots.
 */
export async function buildAdsContext(): Promise<MultiAccountAdsContext> {
  const conns = await db
    .select()
    .from(metaConnections)
    .where(eq(metaConnections.status, 'active'));

  const range: DateRange = {
    since: isoDateOffset(-6),
    until: isoDateOffset(0),
  };

  const accounts: AccountContext[] = [];
  let grandSpend = 0;
  let grandResults = 0;
  let grandActiveCampaigns = 0;

  for (const conn of conns) {
    const brand = detectBrand(conn.accountName);
    const allCampaigns = await loadLatestCampaignSnapshots(conn.id);
    const active = allCampaigns.filter((s) => s.status === 'ACTIVE');
    const paused = allCampaigns
      .filter((s) => s.status === 'PAUSED')
      .sort((a, b) => b.fetchedAt.getTime() - a.fetchedAt.getTime())
      .slice(0, 5);

    // Pre-load adsets buat destination_type lookup (dipakai classifyCampaign
    // untuk pilih channel benchmark yang tepat) + sum daily_budget kalau
    // campaign-nya ABO.
    const adsetsByCampaign = await loadLatestAdsetsByCampaign(conn.id);

    const targets: Target[] = active.map((c) => ({ type: 'campaign', id: c.objectId }));
    const insights = targets.length > 0
      ? await analyze({ connectionId: conn.id, targets, range })
      : null;

    const activeRows: CampaignContextRow[] = active.map((snap) => {
      const t = insights?.perTarget.find((x) => x.target.id === snap.objectId);
      const s = t?.summary;
      const objective = extractObjective(snap);
      const adsets = adsetsByCampaign.get(snap.objectId) ?? [];
      const destType = adsets[0]
        ? extractStringField(adsets[0].rawPayload, 'destination_type')
        : null;
      const channelInfo = classifyCampaign(objective, destType, snap.name);
      const bench = channelInfo
        ? lookupBenchmark(brand, channelInfo.channel)
        : { cheap: 0, expensive: 0 };
      const budget = extractCampaignBudget(snap, adsets);
      return {
        id: snap.objectId,
        name: snap.name,
        status: snap.status,
        effectiveStatus: snap.effectiveStatus,
        objective,
        ageDays: extractAgeDays(snap),
        spendIdr: s?.spend ?? 0,
        results: s?.results ?? 0,
        cprIdr: s?.cpr ?? 0,
        ctrPct: s?.ctr ?? 0,
        impressions: s?.impressions ?? 0,
        clicks: s?.clicks ?? 0,
        resultActionType: s?.resultActionType ?? null,
        benchmarkLabel: channelInfo?.channel ?? 'unclassified',
        benchmarkCheap: bench.cheap,
        benchmarkExpensive: bench.expensive,
        dailyBudgetIdr: budget.dailyBudgetIdr,
        budgetLevel: budget.level,
        hasLifetimeBudget: budget.hasLifetimeBudget,
      };
    });
    activeRows.sort((a, b) => b.spendIdr - a.spendIdr);

    const recentlyPausedRows: CampaignContextRow[] = paused.map((snap) => ({
      id: snap.objectId,
      name: snap.name,
      status: snap.status,
      effectiveStatus: snap.effectiveStatus,
      objective: extractObjective(snap),
      ageDays: extractAgeDays(snap),
      spendIdr: 0,
      results: 0,
      cprIdr: 0,
      ctrPct: 0,
      impressions: 0,
      clicks: 0,
      resultActionType: null,
      benchmarkLabel: 'paused',
      benchmarkCheap: 0,
      benchmarkExpensive: 0,
      dailyBudgetIdr: null,
      budgetLevel: null,
      hasLifetimeBudget: false,
    }));

    const totals = {
      activeSpendIdr: insights?.rollup.spend ?? 0,
      activeResults: insights?.rollup.results ?? 0,
      avgCprIdr: insights?.rollup.cpr ?? 0,
    };
    grandSpend += totals.activeSpendIdr;
    grandResults += totals.activeResults;
    grandActiveCampaigns += active.length;

    accounts.push({
      name: conn.accountName,
      adAccountId: conn.adAccountId,
      brand,
      active: activeRows,
      recentlyPaused: recentlyPausedRows,
      totals,
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    dateRange: range,
    accounts,
    grandTotals: {
      activeSpendIdr: grandSpend,
      activeResults: grandResults,
      avgCprIdr: grandResults > 0 ? grandSpend / grandResults : 0,
      activeCampaigns: grandActiveCampaigns,
    },
  };
}

/**
 * Renders the multi-account context into deterministic text. Account order
 * follows DB query order (created_at), campaign order follows spend desc.
 * Stable ordering is required for Anthropic prompt-cache hits across requests
 * with unchanged data.
 */
export function formatContextForPrompt(ctx: MultiAccountAdsContext): string {
  const lines: string[] = [];
  lines.push(
    `Window: ${ctx.dateRange.since} to ${ctx.dateRange.until} (last 7 days)`,
  );
  lines.push(
    `GRAND TOTALS across ${ctx.accounts.length} accounts: ` +
      `spend Rp ${fmtNum(ctx.grandTotals.activeSpendIdr)}, ` +
      `results ${ctx.grandTotals.activeResults}, ` +
      `avg CPR Rp ${fmtNum(ctx.grandTotals.avgCprIdr)}, ` +
      `${ctx.grandTotals.activeCampaigns} active campaigns total.`,
  );
  lines.push('');

  for (const acc of ctx.accounts) {
    lines.push('========================================');
    lines.push(`ACCOUNT: ${acc.name} (act_${acc.adAccountId})`);
    lines.push(`  brand: ${acc.brand}`);
    lines.push(
      `  subtotal: spend Rp ${fmtNum(acc.totals.activeSpendIdr)}, ` +
        `results ${acc.totals.activeResults}, ` +
        `avg CPR Rp ${fmtNum(acc.totals.avgCprIdr)}`,
    );
    lines.push(`  ACTIVE CAMPAIGNS (${acc.active.length}, sorted by spend desc):`);
    if (acc.active.length === 0) {
      lines.push('    (none)');
    } else {
      for (const c of acc.active) lines.push(formatCampaignRow(c));
    }
    if (acc.recentlyPaused.length > 0) {
      lines.push(`  RECENTLY PAUSED (${acc.recentlyPaused.length} most recent):`);
      for (const c of acc.recentlyPaused) {
        lines.push(
          `    - ${c.name} (id ${c.id}, age ${c.ageDays ?? '?'}d, ${c.objective ?? 'unknown obj'})`,
        );
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

function formatCampaignRow(c: CampaignContextRow): string {
  // Benchmark line cuma di-print kalau ke-classify ke channel known.
  const benchLine =
    c.benchmarkLabel === 'unclassified' || c.benchmarkLabel === 'paused'
      ? ''
      : `\n      benchmark (${c.benchmarkLabel}): cheap < Rp ${fmtNum(c.benchmarkCheap)}, expensive > Rp ${fmtNum(c.benchmarkExpensive)}`;
  return (
    `    - ${c.name}\n` +
    `      id: ${c.id}\n` +
    `      objective: ${c.objective ?? 'unknown'}, age: ${c.ageDays ?? '?'}d, delivery: ${c.effectiveStatus}\n` +
    `      ${formatBudgetLine(c)}\n` +
    `      spend Rp ${fmtNum(c.spendIdr)} | results ${c.results} (${c.resultActionType ?? '-'}) | ` +
    `CPR Rp ${fmtNum(c.cprIdr)} | CTR ${c.ctrPct}% | impressions ${fmtNum(c.impressions)} | clicks ${fmtNum(c.clicks)}` +
    benchLine
  );
}

function formatBudgetLine(c: CampaignContextRow): string {
  if (c.dailyBudgetIdr != null && c.budgetLevel === 'cbo') {
    return `Budget harian: Rp ${fmtNum(c.dailyBudgetIdr)} (CBO)`;
  }
  if (c.dailyBudgetIdr != null && c.budgetLevel === 'abo') {
    return `Budget harian: Rp ${fmtNum(c.dailyBudgetIdr)} (ABO, total adset level)`;
  }
  if (c.hasLifetimeBudget) {
    return 'Budget harian: pakai lifetime_budget (bukan daily) — data tidak tersedia';
  }
  return 'Budget harian: belum ke-sync (jalankan /accountsync)';
}

function fmtNum(n: number): string {
  return Math.round(n).toLocaleString('id-ID');
}

async function loadLatestCampaignSnapshots(
  connectionId: string,
): Promise<MetaObjectSnapshot[]> {
  const rows = await db
    .select()
    .from(metaObjectSnapshots)
    .where(
      and(
        eq(metaObjectSnapshots.connectionId, connectionId),
        eq(metaObjectSnapshots.objectType, 'campaign'),
      ),
    )
    .orderBy(desc(metaObjectSnapshots.fetchedAt));
  const latest = new Map<string, MetaObjectSnapshot>();
  for (const r of rows) {
    if (!latest.has(r.objectId)) latest.set(r.objectId, r);
  }
  return [...latest.values()];
}

/**
 * Map campaign_id → latest adset snapshots (one per distinct adset id).
 * Dipakai buat:
 *  - narikin destination_type sehingga classifyCampaign bisa pilih channel
 *    benchmark yang benar (mis. WhatsApp vs Website leads).
 *  - sum daily_budget per campaign kalau ABO (budget di adset level).
 */
async function loadLatestAdsetsByCampaign(
  connectionId: string,
): Promise<Map<string, MetaObjectSnapshot[]>> {
  const rows = await db
    .select()
    .from(metaObjectSnapshots)
    .where(
      and(
        eq(metaObjectSnapshots.connectionId, connectionId),
        eq(metaObjectSnapshots.objectType, 'adset'),
      ),
    )
    .orderBy(desc(metaObjectSnapshots.fetchedAt));
  const seen = new Set<string>();
  const out = new Map<string, MetaObjectSnapshot[]>();
  for (const r of rows) {
    if (!r.campaignId) continue;
    if (seen.has(r.objectId)) continue;
    seen.add(r.objectId);
    const list = out.get(r.campaignId);
    if (list) list.push(r);
    else out.set(r.campaignId, [r]);
  }
  return out;
}

interface BudgetExtraction {
  dailyBudgetIdr: number | null;
  level: 'cbo' | 'abo' | null;
  hasLifetimeBudget: boolean;
}

/**
 * Extracts daily budget from campaign + adset snapshots.
 *
 * - CBO: campaign rawPayload.daily_budget > 0 → that's the budget.
 * - ABO: campaign daily_budget absent/0, adsets have daily_budget > 0 →
 *   sum across non-paused adsets. Sum is the campaign's daily cap.
 * - Lifetime: campaign atau adset pakai lifetime_budget — flagged so AI
 *   tahu kenapa daily nilai-nya null (bukan karena belum ke-sync).
 *
 * Meta returns budget as a string in account currency's smallest unit; for
 * IDR `currencyMinorPerUnit = 1`, jadi langsung whole rupiah.
 */
function extractCampaignBudget(
  campaign: MetaObjectSnapshot,
  adsets: MetaObjectSnapshot[],
): BudgetExtraction {
  const factor = config.optimizer.currencyMinorPerUnit;
  const cbo = parseBudgetField(campaign.rawPayload, 'daily_budget');
  const cboLifetime = parseBudgetField(campaign.rawPayload, 'lifetime_budget');

  if (cbo != null && cbo > 0) {
    return {
      dailyBudgetIdr: cbo / factor,
      level: 'cbo',
      hasLifetimeBudget: false,
    };
  }

  let sum = 0;
  let anyAdsetDaily = false;
  let anyAdsetLifetime = false;
  for (const a of adsets) {
    if (a.status === 'PAUSED' || a.status === 'DELETED' || a.status === 'ARCHIVED') {
      continue;
    }
    const d = parseBudgetField(a.rawPayload, 'daily_budget');
    if (d != null && d > 0) {
      sum += d;
      anyAdsetDaily = true;
    }
    if (parseBudgetField(a.rawPayload, 'lifetime_budget')) {
      anyAdsetLifetime = true;
    }
  }
  if (anyAdsetDaily) {
    return {
      dailyBudgetIdr: sum / factor,
      level: 'abo',
      hasLifetimeBudget: false,
    };
  }
  return {
    dailyBudgetIdr: null,
    level: null,
    hasLifetimeBudget: (cboLifetime != null && cboLifetime > 0) || anyAdsetLifetime,
  };
}

function parseBudgetField(payload: unknown, key: string): number | null {
  if (!payload || typeof payload !== 'object') return null;
  const v = (payload as Record<string, unknown>)[key];
  if (typeof v === 'string') {
    if (v === '' || v === '0') return null;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  if (typeof v === 'number') return v > 0 ? v : null;
  return null;
}

function extractStringField(payload: unknown, key: string): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const v = (payload as Record<string, unknown>)[key];
  return typeof v === 'string' ? v : null;
}

function extractObjective(snap: MetaObjectSnapshot): string | null {
  const raw = snap.rawPayload as { objective?: unknown } | null;
  if (!raw || typeof raw !== 'object') return null;
  return typeof raw.objective === 'string' ? raw.objective : null;
}

function extractAgeDays(snap: MetaObjectSnapshot): number | null {
  const raw = snap.rawPayload as { created_time?: unknown } | null;
  if (!raw || typeof raw !== 'object') return null;
  const ct = raw.created_time;
  if (typeof ct !== 'string') return null;
  const created = new Date(ct);
  if (Number.isNaN(created.getTime())) return null;
  return Math.floor((Date.now() - created.getTime()) / (24 * 60 * 60 * 1000));
}

function isoDateOffset(daysFromToday: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromToday);
  return d.toISOString().slice(0, 10);
}
