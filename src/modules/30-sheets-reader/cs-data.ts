import { logger } from '../00-foundation/index.js';
import {
  BUSINESSES,
  type Business,
  type BusinessSheet,
} from './business-resolver.js';
import {
  parseCellNumber,
  parseCellString,
  sheetsSerialToIsoDate,
  isNoData,
  NO_DATA,
  type NoData,
} from './cell-utils.js';
import { getReadClient } from './sheets-client.js';

/**
 * Layout tab "CS PERFORM" (header row 1, data dari row 2):
 *   A Tanggal  B Head/Provinsi  C CustomerService
 *   D Chat  E Closing  F Ekor/Keberangkatan  G Revenue
 *   H BiayaPerCS  I CAC  J SAC
 */
const CS_PERFORM_RANGE = 'A2:J';

export interface CsPerformRow {
  business: Business;
  /** Display label business + branch ("Aqiqah Express - PUSAT"). */
  contextLabel: string;
  isoDate: string;
  branch: string;
  csName: string;
  chat: number | NoData;
  closing: number | NoData;
  ekor: number | NoData;
  revenue: number | NoData;
  biayaPerCs: number | NoData;
  cac: number | NoData;
  sac: number | NoData;
}

export interface CsAggregate {
  business: Business;
  contextLabel: string;
  csName: string;
  /** Cabang yang ke-detect dari B (Head). Kalau CS muncul di banyak Head,
   *  diambil yang pertama appear. */
  branch: string;
  rangeStart: string;
  rangeEnd: string;
  /** Jumlah hari yang ada data (≥1 metric non-NO_DATA). */
  daysWithData: number;
  /** Total dari kolom yang accumulate-able. */
  totalChat: number;
  totalClosing: number;
  totalEkor: number;
  totalRevenue: number;
  totalBiayaCs: number;
  /** CAC/SAC tidak boleh di-sum — pakai average dari hari yang ada data. */
  avgCac: number | NoData;
  avgSac: number | NoData;
  /** closing / chat × 100 (0 kalau chat = 0). */
  closingRatePct: number;
}

const csPerformCache = new Map<
  string,
  { rows: CsPerformRow[]; expiresAt: number }
>();
const TTL_MS = 60 * 60 * 1000; // 1 jam

/**
 * Read tab CS PERFORM untuk satu spreadsheet, cache 1 jam. Bisa di-bust
 * via clearCsCache().
 */
async function readCsPerform(biz: BusinessSheet): Promise<CsPerformRow[]> {
  const now = Date.now();
  const cached = csPerformCache.get(biz.spreadsheetId);
  if (cached && cached.expiresAt > now) return cached.rows;

  const sheets = getReadClient();
  // ⚠️ Actual tab name di kedua spreadsheet adalah "CS PERFORM " dengan
  // TRAILING SPACE — sengaja oleh Bang Rian (atau historical artifact).
  // Sheets API exact-match. Jangan trim.
  const range = `'CS PERFORM '!${CS_PERFORM_RANGE}`;
  let res;
  try {
    res = await sheets.spreadsheets.values.get({
      spreadsheetId: biz.spreadsheetId,
      range,
      // UNFORMATTED → number cells balik sebagai number; date balik
      // sebagai serial (bisa di-decode di sheetsSerialToIsoDate).
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'SERIAL_NUMBER',
    });
  } catch (err) {
    logger.error(
      { err, spreadsheetId: biz.spreadsheetId },
      'sheets-reader: CS PERFORM read failed',
    );
    return [];
  }
  const raw = (res.data.values ?? []) as unknown[][];
  const rows: CsPerformRow[] = [];
  for (const r of raw) {
    const csName = parseCellString(r[2]);
    if (!csName) continue;
    const dateRaw = r[0];
    let isoDate = '';
    if (typeof dateRaw === 'number' && Number.isFinite(dateRaw)) {
      isoDate = sheetsSerialToIsoDate(dateRaw);
    } else if (typeof dateRaw === 'string' && dateRaw.trim()) {
      // Fallback kalau cell bukan serial — skip baris ini, indikasi
      // header row mungkin ke-include atau row rusak.
      continue;
    } else {
      continue;
    }
    rows.push({
      business: biz.business,
      contextLabel: biz.label,
      isoDate,
      branch: parseCellString(r[1]),
      csName,
      chat: parseCellNumber(r[3]),
      closing: parseCellNumber(r[4]),
      ekor: parseCellNumber(r[5]),
      revenue: parseCellNumber(r[6]),
      biayaPerCs: parseCellNumber(r[7]),
      cac: parseCellNumber(r[8]),
      sac: parseCellNumber(r[9]),
    });
  }
  csPerformCache.set(biz.spreadsheetId, {
    rows,
    expiresAt: now + TTL_MS,
  });
  logger.info(
    {
      spreadsheetId: biz.spreadsheetId,
      rows: rows.length,
      cachedUntil: new Date(now + TTL_MS).toISOString(),
    },
    'sheets-reader: CS PERFORM loaded',
  );
  return rows;
}

/** Bust cache untuk semua spreadsheet (dipanggil oleh /refresh-cs). */
export function clearCsCache(): void {
  csPerformCache.clear();
}

/**
 * Read CS PERFORM dari SEMUA spreadsheet sekaligus. Return one big list —
 * caller filter by name/date/business.
 */
export async function loadAllCsPerform(): Promise<CsPerformRow[]> {
  const out: CsPerformRow[] = [];
  for (const biz of BUSINESSES) {
    const rows = await readCsPerform(biz);
    out.push(...rows);
  }
  return out;
}

// ---------- CS name lookup ----------

export interface CsMatch {
  csName: string;
  business: Business;
  contextLabel: string;
  branch: string;
}

/**
 * Cari CS by fuzzy name (case-insensitive substring) di SEMUA spreadsheet.
 * Return semua match — caller decide kalau >1 = ambiguous.
 */
export async function findCsByName(query: string): Promise<CsMatch[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const all = await loadAllCsPerform();
  const seen = new Set<string>();
  const matches: CsMatch[] = [];
  for (const r of all) {
    if (!r.csName.toLowerCase().includes(q)) continue;
    const key = `${r.business}::${r.csName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    matches.push({
      csName: r.csName,
      business: r.business,
      contextLabel: r.contextLabel,
      branch: r.branch,
    });
  }
  // Prioritas: exact match dulu, baru substring. Putri exact > Putri-anything.
  matches.sort((a, b) => {
    const aExact = a.csName.toLowerCase() === q ? 0 : 1;
    const bExact = b.csName.toLowerCase() === q ? 0 : 1;
    if (aExact !== bExact) return aExact - bExact;
    return a.csName.localeCompare(b.csName);
  });
  return matches;
}

// ---------- Aggregations ----------

export function aggregateCsForRange(
  rows: CsPerformRow[],
  csName: string,
  business: Business,
  rangeStart: string,
  rangeEnd: string,
): CsAggregate | null {
  const filtered = rows.filter(
    (r) =>
      r.business === business &&
      r.csName.toLowerCase() === csName.toLowerCase() &&
      r.isoDate >= rangeStart &&
      r.isoDate <= rangeEnd,
  );
  if (filtered.length === 0) return null;

  let totalChat = 0;
  let totalClosing = 0;
  let totalEkor = 0;
  let totalRevenue = 0;
  let totalBiayaCs = 0;
  let cacSum = 0;
  let cacCount = 0;
  let sacSum = 0;
  let sacCount = 0;
  let daysWithData = 0;
  let firstBranch = '';

  for (const r of filtered) {
    let hasAny = false;
    if (!isNoData(r.chat)) {
      totalChat += r.chat;
      hasAny = true;
    }
    if (!isNoData(r.closing)) {
      totalClosing += r.closing;
      hasAny = true;
    }
    if (!isNoData(r.ekor)) {
      totalEkor += r.ekor;
      hasAny = true;
    }
    if (!isNoData(r.revenue)) {
      totalRevenue += r.revenue;
      hasAny = true;
    }
    if (!isNoData(r.biayaPerCs)) {
      totalBiayaCs += r.biayaPerCs;
      hasAny = true;
    }
    if (!isNoData(r.cac) && r.cac > 0) {
      cacSum += r.cac;
      cacCount += 1;
    }
    if (!isNoData(r.sac) && r.sac > 0) {
      sacSum += r.sac;
      sacCount += 1;
    }
    if (hasAny) daysWithData += 1;
    if (!firstBranch && r.branch) firstBranch = r.branch;
  }

  return {
    business,
    contextLabel: filtered[0]!.contextLabel,
    csName: filtered[0]!.csName, // gunakan casing asli dari Sheet
    branch: firstBranch,
    rangeStart,
    rangeEnd,
    daysWithData,
    totalChat,
    totalClosing,
    totalEkor,
    totalRevenue,
    totalBiayaCs,
    avgCac: cacCount > 0 ? cacSum / cacCount : NO_DATA,
    avgSac: sacCount > 0 ? sacSum / sacCount : NO_DATA,
    closingRatePct: totalChat > 0 ? (totalClosing / totalChat) * 100 : 0,
  };
}

/** Ranking semua CS untuk range tertentu, by total revenue desc. */
export interface CsRankingRow {
  business: Business;
  contextLabel: string;
  csName: string;
  branch: string;
  totalRevenue: number;
  totalClosing: number;
  totalChat: number;
}

export async function rankAllCsForRange(
  rangeStart: string,
  rangeEnd: string,
): Promise<CsRankingRow[]> {
  const all = await loadAllCsPerform();
  // Group by (business, csName).
  const buckets = new Map<string, CsRankingRow>();
  for (const r of all) {
    if (r.isoDate < rangeStart || r.isoDate > rangeEnd) continue;
    const key = `${r.business}::${r.csName}`;
    let b = buckets.get(key);
    if (!b) {
      b = {
        business: r.business,
        contextLabel: r.contextLabel,
        csName: r.csName,
        branch: r.branch,
        totalRevenue: 0,
        totalClosing: 0,
        totalChat: 0,
      };
      buckets.set(key, b);
    }
    if (!isNoData(r.revenue)) b.totalRevenue += r.revenue;
    if (!isNoData(r.closing)) b.totalClosing += r.closing;
    if (!isNoData(r.chat)) b.totalChat += r.chat;
  }
  const out = [...buckets.values()];
  out.sort((a, b) => b.totalRevenue - a.totalRevenue);
  return out;
}
