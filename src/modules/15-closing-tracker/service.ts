import { and, eq, gte, lte, sql } from 'drizzle-orm';
// Migrated to 00-foundation (Phase 5 pilot): db / config / logger via
// foundation re-exports. Drizzle schema imports tetap langsung — schema
// table objects belum di-namespace di foundation.
import { db, appConfig as config, logger } from '../00-foundation/index.js';
import { closingRecords } from '../../db/schema/closing-records.js';
import { metaConnections } from '../../db/schema/meta-connections.js';
import { metaObjectSnapshots } from '../../db/schema/meta-object-snapshots.js';
import {
  analyze,
  type DateRange,
  type Target,
} from '../02-ads-analysis/index.js';
import {
  getClosingRevenueForAccount,
  unitForKind,
  type BusinessKind,
} from '../13-sheets-integration/index.js';

export interface RecordClosingInput {
  connectionId: string;
  closingDate: string; // YYYY-MM-DD
  quantity: number;
  /** Revenue in IDR units (rupiah, not minor). Caller passes integer rupiah
   *  e.g. 75000000 = Rp 75 juta. Conversion to minor happens here. */
  revenueIdr: number;
  notes?: string | undefined;
  createdBy?: string | undefined;
}

export type ClosingSource = 'sheets' | 'manual' | 'none';

export interface RoasAccountRow {
  connectionId: string;
  accountName: string;
  adAccountId: string;
  /** Domain unit label — "jamaah" for travel, "ekor" for aqiqah, etc. */
  unit: string;
  spendIdr: number;
  revenueIdr: number;
  closingQuantity: number;
  /** Computed ROAS = revenueIdr / spendIdr (0 when spend = 0). */
  roas: number;
  /** Where the closing/revenue numbers came from. "sheets" = Google Sheets
   *  per-account tab; "manual" = sum of closing_records rows; "none" = no
   *  data source matched. */
  closingSource: ClosingSource;
  /** Optional human-readable note when Sheets failed and we fell back. */
  closingNote?: string;
}

export interface RoasReport {
  rangeLabel: string;
  range: DateRange;
  perAccount: RoasAccountRow[];
  totalSpendIdr: number;
  totalRevenueIdr: number;
  totalRoas: number;
}

/**
 * Inserts a closing record. Caller MUST have already validated approver
 * status — this function does not gate by user.
 */
export async function recordClosing(
  input: RecordClosingInput,
): Promise<{ id: string; adAccountId: string }> {
  const [conn] = await db
    .select()
    .from(metaConnections)
    .where(eq(metaConnections.id, input.connectionId))
    .limit(1);
  if (!conn) {
    throw new Error(`Connection ${input.connectionId} not found.`);
  }
  const revenueMinor = BigInt(
    Math.round(input.revenueIdr * config.optimizer.currencyMinorPerUnit),
  );
  const [row] = await db
    .insert(closingRecords)
    .values({
      connectionId: input.connectionId,
      adAccountId: conn.adAccountId,
      closingDate: input.closingDate,
      quantity: input.quantity,
      revenueMinor,
      notes: input.notes ?? null,
      createdBy: input.createdBy ?? null,
    })
    .returning({ id: closingRecords.id });
  if (!row) throw new Error('Failed to insert closing record');
  return { id: row.id, adAccountId: conn.adAccountId };
}

/**
 * Resolves a free-form alias from /closing args to a connection. Matches
 * substring (case-insensitive) against accountName. Returns null when 0 or
 * >1 connections match — caller should disambiguate.
 */
export async function resolveConnectionByAlias(
  alias: string,
): Promise<
  | { ok: true; connection: typeof metaConnections.$inferSelect }
  | { ok: false; reason: 'not_found' | 'ambiguous'; matches: string[] }
> {
  const trimmed = alias.trim();
  if (!trimmed) return { ok: false, reason: 'not_found', matches: [] };
  const rows = await db
    .select()
    .from(metaConnections)
    .where(sql`${metaConnections.accountName} ILIKE ${`%${trimmed}%`}`);
  if (rows.length === 0) {
    return { ok: false, reason: 'not_found', matches: [] };
  }
  if (rows.length > 1) {
    return {
      ok: false,
      reason: 'ambiguous',
      matches: rows.map((r) => r.accountName),
    };
  }
  return { ok: true, connection: rows[0]! };
}

/**
 * Build ROAS report for a `periodDays`-wide window ending `endOffsetDays`
 * back from today (default 0 = today). Thin wrapper around
 * `buildRoasReportForRange` for callers that think in relative days.
 *
 *   buildRoasReport(7)      → last 7 days ending today
 *   buildRoasReport(1, 1)   → just yesterday
 *   buildRoasReport(7, 1)   → 7 days ending yesterday (excludes today)
 */
export async function buildRoasReport(
  periodDays: number,
  endOffsetDays = 0,
): Promise<RoasReport> {
  if (!Number.isFinite(periodDays) || periodDays < 1) {
    throw new Error('periodDays must be a positive integer');
  }
  if (!Number.isFinite(endOffsetDays) || endOffsetDays < 0) {
    throw new Error('endOffsetDays must be >= 0');
  }
  const until = isoDateOffset(-endOffsetDays);
  const since = isoDateOffset(-(endOffsetDays + periodDays - 1));
  const label =
    periodDays === 1 ? since : `${periodDays}d (${since} → ${until})`;
  return buildRoasReportForRange({ since, until }, label);
}

/**
 * Range-driven ROAS builder. Used by /roas with arbitrary user-supplied
 * date ranges. `label` is what the formatter prints in the report header
 * — pass the human-friendly form ("01 Apr → 15 Apr", "7d (...)").
 */
export async function buildRoasReportForRange(
  range: DateRange,
  label?: string,
): Promise<RoasReport> {
  const { since, until } = range;
  if (since > until) {
    throw new Error(`since (${since}) must be <= until (${until})`);
  }
  const factor = config.optimizer.currencyMinorPerUnit;

  const conns = await db
    .select()
    .from(metaConnections)
    .where(eq(metaConnections.status, 'active'));

  const perAccount: RoasAccountRow[] = [];
  let totalSpend = 0;
  let totalRevenue = 0;

  for (const conn of conns) {
    // Spend: sum across every active campaign for the window. analyze()
    // handles snapshot caching, so a recent run keeps this cheap.
    const campaignIds = await listActiveCampaignIds(conn.id);
    let spend = 0;
    if (campaignIds.length > 0) {
      const targets: Target[] = campaignIds.map((id) => ({
        type: 'campaign',
        id,
      }));
      try {
        const r = await analyze({ connectionId: conn.id, targets, range });
        spend = r.rollup.spend;
      } catch {
        // If insight fetch fails for one account, surface 0 spend rather than
        // failing the whole ROAS report.
        spend = 0;
      }
    }

    // Closing + revenue: prefer Google Sheets (operator's source of truth).
    // Fall back to closing_records SUM when (a) the account has no matching
    // sheet (e.g. a new connection) or (b) the Sheets read errored.
    let revenueIdr = 0;
    let closingQuantity = 0;
    let closingSource: ClosingSource = 'none';
    let closingNote: string | undefined;
    let unit = domainUnitFor(conn.accountName);

    const sheetResult = await getClosingRevenueForAccount(
      conn.accountName,
      since,
      until,
    );
    if (sheetResult.source && sheetResult.error == null) {
      revenueIdr = sheetResult.aggregate.totalRevenueIdr;
      closingQuantity = sheetResult.aggregate.totalClosing;
      closingSource = 'sheets';
      unit = unitForKind(sheetResult.source.kind);
    } else {
      if (sheetResult.error) {
        logger.warn(
          { connectionId: conn.id, error: sheetResult.error },
          'closing-tracker: Sheets read failed, falling back to manual closing_records',
        );
        closingNote = `Sheets error: ${sheetResult.error}`;
      }
      const [agg] = await db
        .select({
          revenueMinor: sql<bigint>`COALESCE(SUM(${closingRecords.revenueMinor}), 0)`,
          quantity: sql<number>`COALESCE(SUM(${closingRecords.quantity}), 0)::int`,
        })
        .from(closingRecords)
        .where(
          and(
            eq(closingRecords.connectionId, conn.id),
            gte(closingRecords.closingDate, since),
            lte(closingRecords.closingDate, until),
          ),
        );
      const manualRevenue = Number(agg?.revenueMinor ?? 0n) / factor;
      const manualQuantity = Number(agg?.quantity ?? 0);
      if (manualRevenue > 0 || manualQuantity > 0) {
        revenueIdr = manualRevenue;
        closingQuantity = manualQuantity;
        closingSource = 'manual';
      }
    }

    const row: RoasAccountRow = {
      connectionId: conn.id,
      accountName: conn.accountName,
      adAccountId: conn.adAccountId,
      unit,
      spendIdr: spend,
      revenueIdr,
      closingQuantity,
      roas: spend > 0 ? revenueIdr / spend : 0,
      closingSource,
      ...(closingNote !== undefined ? { closingNote } : {}),
    };
    perAccount.push(row);
    totalSpend += spend;
    totalRevenue += revenueIdr;
  }

  perAccount.sort((a, b) => a.accountName.localeCompare(b.accountName));

  const finalLabel =
    label ?? (since === until ? since : `${since} → ${until}`);
  return {
    rangeLabel: finalLabel,
    range,
    perAccount,
    totalSpendIdr: totalSpend,
    totalRevenueIdr: totalRevenue,
    totalRoas: totalSpend > 0 ? totalRevenue / totalSpend : 0,
  };
}

/** Pick the right counting noun for an account based on name heuristics. */
function domainUnitFor(accountName: string): string {
  const n = accountName.toLowerCase();
  if (n.includes('aqiqah')) return 'ekor';
  return 'jamaah';
}

async function listActiveCampaignIds(connectionId: string): Promise<string[]> {
  const snaps = await loadActiveCampaignSnapshots(connectionId);
  return snaps.map((r) => r.objectId);
}

async function loadActiveCampaignSnapshots(connectionId: string) {
  const rows = await db
    .select()
    .from(metaObjectSnapshots)
    .where(
      and(
        eq(metaObjectSnapshots.connectionId, connectionId),
        eq(metaObjectSnapshots.objectType, 'campaign'),
      ),
    );
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const cur = latest.get(r.objectId);
    if (!cur || r.fetchedAt.getTime() > cur.fetchedAt.getTime()) {
      latest.set(r.objectId, r);
    }
  }
  return [...latest.values()].filter((r) => r.status === 'ACTIVE');
}

function isoDateOffset(daysFromToday: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromToday);
  return d.toISOString().slice(0, 10);
}

// ---------- Per-campaign ROAS ----------

export interface CampaignRoasRow {
  connectionId: string;
  accountName: string;
  /** null when the account doesn't map to a known sheet (e.g. brand-new
   *  connection with no business kind we can infer). */
  business: BusinessKind | null;
  campaignId: string;
  campaignName: string;
  spendIdr: number;
  results: number;
  /**
   * Revenue per-campaign hasil pro-rate dari revenue level account:
   *   `(account_revenue / account_closings) × campaign_results`
   * — alias rata-rata harga deal × jumlah conversion yang Meta atribusikan
   * ke campaign ini.
   *
   * Kalau Meta results sama persis dengan jumlah closing di Sheets, total
   * estimasi ini = revenue account. Kalau account-nya belum ada closing di
   * Sheets, nilainya 0 untuk semua campaign.
   *
   * Ini ATTRIBUTION PROXY, bukan revenue real per-campaign. Source data
   * (Sheets) cuma punya angka per-account, bukan per-campaign — jadi
   * pendekatan ini yang paling masuk akal sampai ada tagging WA→close
   * per-campaign.
   */
  estimatedRevenueIdr: number;
  /** estimatedRevenueIdr / spendIdr; 0 when spend=0. */
  roas: number;
}

/**
 * @deprecated 2026-04-26 (Tahap 2 rebuild).
 *
 * Per-campaign ROAS pakai proportional attribution (avg deal value ×
 * Meta-attributed results). Konsekuensinya ROAS dalam satu account jadi
 * "konstan" untuk campaign dengan results sama — bukan revenue real
 * per-campaign. User memutuskan ganti ke pipeline 100% Sheets di module
 * `30-sheets-reader`, dimana ROAS dibaca apa adanya dari kolom AN
 * REPORTING tab (no recalc).
 *
 * Function masih dipertahankan untuk:
 *   - /top dan /worst (deprecated, transition window)
 *   - /alerts deprecated handler
 * Jangan dipakai untuk feature baru.
 */
export async function buildCampaignRoasForRange(
  range: DateRange,
): Promise<CampaignRoasRow[]> {
  const conns = await db
    .select()
    .from(metaConnections)
    .where(eq(metaConnections.status, 'active'));

  const out: CampaignRoasRow[] = [];

  for (const conn of conns) {
    // Avg harga deal per-account, hitung dari revenue ÷ jumlah closing di Sheets.
    // Ini yang dipakai untuk pro-rate revenue ke campaign-campaign account.
    const sheetResult = await getClosingRevenueForAccount(
      conn.accountName,
      range.since,
      range.until,
    );
    let avgDealIdr = 0;
    let business: BusinessKind | null = null;
    if (sheetResult.source) business = sheetResult.source.kind;
    if (
      sheetResult.source &&
      sheetResult.error == null &&
      sheetResult.aggregate.totalClosing > 0
    ) {
      avgDealIdr =
        sheetResult.aggregate.totalRevenueIdr /
        sheetResult.aggregate.totalClosing;
    }

    const snaps = await loadActiveCampaignSnapshots(conn.id);
    if (snaps.length === 0) continue;

    const targets: Target[] = snaps.map((s) => ({
      type: 'campaign',
      id: s.objectId,
    }));
    let analyzeResult;
    try {
      analyzeResult = await analyze({
        connectionId: conn.id,
        targets,
        range,
      });
    } catch {
      // Read insight gagal untuk account ini — skip aja, jangan bikin
      // ranking seluruhnya gagal cuma karena satu account error.
      continue;
    }

    for (const t of analyzeResult.perTarget) {
      const snap = snaps.find((s) => s.objectId === t.target.id);
      if (!snap) continue;
      const spend = t.summary.spend;
      const results = t.summary.results;
      const estimatedRevenue = avgDealIdr * results;
      out.push({
        connectionId: conn.id,
        accountName: conn.accountName,
        business,
        campaignId: t.target.id,
        campaignName: snap.name,
        spendIdr: spend,
        results,
        estimatedRevenueIdr: estimatedRevenue,
        roas: spend > 0 ? estimatedRevenue / spend : 0,
      });
    }
  }

  return out;
}
