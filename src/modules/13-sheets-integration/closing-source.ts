import { logger } from '../../lib/logger.js';
import { readSheetData } from './reader.js';
import { SHEET_SOURCES, type BusinessKind, type SheetSource } from './report.js';

export interface ClosingRevenueAggregate {
  /** Sum of column M (Total Closing) over the requested date range. */
  totalClosing: number;
  /** Sum of column N (Total Jamaah / Total Ekoran). */
  totalKeberangkatan: number;
  /** Sum of column O (Revenue Berjalan), in IDR. */
  totalRevenueIdr: number;
  /** Number of rows actually summed (sheet rows whose dateIso is in range). */
  daysWithData: number;
}

const ZERO: ClosingRevenueAggregate = {
  totalClosing: 0,
  totalKeberangkatan: 0,
  totalRevenueIdr: 0,
  daysWithData: 0,
};

/**
 * Aggregates closing + revenue for a single (spreadsheet, tab) over the
 * inclusive date range [sinceIso, untilIso]. Filters happen client-side
 * after a single sheet read so we get all rows in one network call.
 */
export async function getClosingRevenueForRange(
  spreadsheetId: string,
  tab: string,
  sinceIso: string,
  untilIso: string,
): Promise<ClosingRevenueAggregate> {
  const rows = await readSheetData(spreadsheetId, tab);
  let totalClosing = 0;
  let totalKeberangkatan = 0;
  let totalRevenueIdr = 0;
  let days = 0;
  for (const r of rows) {
    if (!r.dateIso) continue;
    if (r.dateIso < sinceIso || r.dateIso > untilIso) continue;
    totalClosing += r.totalClosing;
    totalKeberangkatan += r.totalKeberangkatan;
    totalRevenueIdr += r.revenue;
    days += 1;
  }
  return { totalClosing, totalKeberangkatan, totalRevenueIdr, daysWithData: days };
}

/**
 * Maps a meta_connections row to its corresponding SheetSource. Match is
 * substring-based on accountName so renames don't break it. The PUSAT
 * pattern needs to differentiate Basmalah's "Basmalah Travel" vs Aqiqah's
 * "PUSAT - Aqiqah Express" — we anchor by the brand keyword first.
 *
 * Returns null when the account has no known sheet (no ROAS via Sheets).
 */
export function matchSheetSourceForAccount(
  accountName: string,
): SheetSource | null {
  const n = accountName.toLowerCase();
  if (n.includes('basmalah')) {
    return SHEET_SOURCES.find((s) => s.kind === 'basmalah') ?? null;
  }
  if (!n.includes('aqiqah')) return null;
  // Aqiqah branch — pick by region prefix in account name.
  const region = pickAqiqahRegion(n);
  if (!region) return null;
  return (
    SHEET_SOURCES.find(
      (s) => s.kind === 'aqiqah' && s.label.toUpperCase().endsWith(region),
    ) ?? null
  );
}

function pickAqiqahRegion(loweredAccountName: string): string | null {
  if (loweredAccountName.includes('pusat')) return 'PUSAT';
  if (loweredAccountName.includes('jabar')) return 'JABAR';
  if (loweredAccountName.includes('jatim')) return 'JATIM';
  // YOGYA in connections corresponds to JOGJA tab.
  if (loweredAccountName.includes('yogya') || loweredAccountName.includes('jogja')) {
    return 'JOGJA';
  }
  return null;
}

/** Per-kind unit label used by ROAS / daily summaries. */
export function unitForKind(kind: BusinessKind): string {
  return kind === 'basmalah' ? 'jamaah' : 'ekor';
}

/**
 * Aggregates closing+revenue for an account by matching its sheet source.
 * Returns the zero-filled aggregate (and `source: null`) when the account
 * has no matching sheet — caller decides whether to fall back to manual
 * closing_records.
 */
export async function getClosingRevenueForAccount(
  accountName: string,
  sinceIso: string,
  untilIso: string,
): Promise<{
  source: SheetSource | null;
  aggregate: ClosingRevenueAggregate;
  error: string | null;
}> {
  const source = matchSheetSourceForAccount(accountName);
  if (!source) return { source: null, aggregate: ZERO, error: null };
  try {
    const aggregate = await getClosingRevenueForRange(
      source.spreadsheetId,
      source.tab,
      sinceIso,
      untilIso,
    );
    return { source, aggregate, error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(
      { err, accountName, tab: source.tab, sinceIso, untilIso },
      'sheets-integration: closing aggregate failed for account',
    );
    return { source, aggregate: ZERO, error: msg };
  }
}
