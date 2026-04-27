import { logger } from '../00-foundation/index.js';
import {
  type BusinessSheet,
  type ResolvedBranch,
} from './business-resolver.js';
import {
  parseCellNumber,
  sheetsSerialToIsoDate,
  isNoData,
  NO_DATA,
  type NoData,
} from './cell-utils.js';
import { getReadClient } from './sheets-client.js';

/**
 * Layout *-REPORTING (header row 1, data row 3+ — row 2 dipakai untuk
 * sub-label channel). Kolom yang relevant ke 5 commands kita:
 *
 *   A  Tgl (date serial)
 *   B  ATC IKLAN (Meta)        F  REAL CHAT MASUK (Meta)
 *   C  Google Ads              G  Google
 *   D  Tiktok Ads              H  Tiktok
 *   E  Total ATC Iklan         I  Total Chat
 *   J  CLOSINGAN (Meta)        N  Total Ekoran/Keberangkatan
 *   K  Closing Google          O  Revenue Berjalan
 *   L  Closing Tiktok          P  Biaya Marketing (Meta)
 *   M  Total Closing           Q  11% Pajak Meta
 *   R  Biaya Google            T  Biaya TikTok
 *   S  11% Pajak Google        U  11% Pajak TikTok
 *   V  Total Biaya Iklan       W  Persentase (%)
 *   X  CR % (Meta)             AA ATC to WA (TikTok)
 *   AB CR % (TikTok)           AE Cost per Conversation
 *   AG CPR DB IKLAN (TikTok)   AH CPR Real WA (Meta)
 *   AJ CPR Real WA (TikTok)    AK WAC
 *   AL CAC                     AM SAC
 *   AN ROAS  ← ★ source of truth
 */
const REPORTING_RANGE = 'A3:AN';

export interface ReportingRow {
  isoDate: string;
  // Channel ATC
  atcMeta: number | NoData;
  atcGoogle: number | NoData;
  atcTiktok: number | NoData;
  totalAtc: number | NoData;
  // Channel chat
  chatMeta: number | NoData;
  chatGoogle: number | NoData;
  chatTiktok: number | NoData;
  totalChat: number | NoData;
  // Closing
  closingMeta: number | NoData;
  closingGoogle: number | NoData;
  closingTiktok: number | NoData;
  totalClosing: number | NoData;
  // Output
  totalEkor: number | NoData;
  revenue: number | NoData;
  // Cost
  biayaMetaRaw: number | NoData;
  pajakMeta: number | NoData;
  biayaGoogleRaw: number | NoData;
  pajakGoogle: number | NoData;
  biayaTiktokRaw: number | NoData;
  pajakTiktok: number | NoData;
  totalBiayaIklan: number | NoData;
  // Ratios (sheet-computed)
  persentase: number | NoData;
  crMeta: number | NoData;
  atcToWaTiktok: number | NoData;
  crTiktok: number | NoData;
  costPerConversation: number | NoData;
  cprDbTiktok: number | NoData;
  cprRealWaMeta: number | NoData;
  cprRealWaTiktok: number | NoData;
  wac: number | NoData;
  cac: number | NoData;
  sac: number | NoData;
  roas: number | NoData;
}

const reportingCache = new Map<
  string,
  { rows: ReportingRow[]; expiresAt: number }
>();
const TTL_MS = 15 * 60 * 1000; // 15 menit — data Reporting refresh sering

export function clearReportingCache(): void {
  reportingCache.clear();
}

async function readReporting(
  spreadsheetId: string,
  tabName: string,
): Promise<ReportingRow[]> {
  const cacheKey = `${spreadsheetId}::${tabName}`;
  const now = Date.now();
  const cached = reportingCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.rows;

  const sheets = getReadClient();
  const range = `'${tabName}'!${REPORTING_RANGE}`;
  let res;
  try {
    res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'SERIAL_NUMBER',
    });
  } catch (err) {
    logger.error(
      { err, spreadsheetId, tabName },
      'sheets-reader: REPORTING read failed',
    );
    return [];
  }
  const raw = (res.data.values ?? []) as unknown[][];
  const out: ReportingRow[] = [];
  for (const r of raw) {
    const dateRaw = r[0];
    if (typeof dateRaw !== 'number' || !Number.isFinite(dateRaw)) continue;
    const isoDate = sheetsSerialToIsoDate(dateRaw);
    out.push({
      isoDate,
      atcMeta: parseCellNumber(r[1]),
      atcGoogle: parseCellNumber(r[2]),
      atcTiktok: parseCellNumber(r[3]),
      totalAtc: parseCellNumber(r[4]),
      chatMeta: parseCellNumber(r[5]),
      chatGoogle: parseCellNumber(r[6]),
      chatTiktok: parseCellNumber(r[7]),
      totalChat: parseCellNumber(r[8]),
      closingMeta: parseCellNumber(r[9]),
      closingGoogle: parseCellNumber(r[10]),
      closingTiktok: parseCellNumber(r[11]),
      totalClosing: parseCellNumber(r[12]),
      totalEkor: parseCellNumber(r[13]),
      revenue: parseCellNumber(r[14]),
      biayaMetaRaw: parseCellNumber(r[15]),
      pajakMeta: parseCellNumber(r[16]),
      biayaGoogleRaw: parseCellNumber(r[17]),
      pajakGoogle: parseCellNumber(r[18]),
      biayaTiktokRaw: parseCellNumber(r[19]),
      pajakTiktok: parseCellNumber(r[20]),
      totalBiayaIklan: parseCellNumber(r[21]),
      persentase: parseCellNumber(r[22]),
      crMeta: parseCellNumber(r[23]),
      // Y, Z (24, 25) di-skip — Google CR jarang dipakai
      atcToWaTiktok: parseCellNumber(r[26]),
      crTiktok: parseCellNumber(r[27]),
      // AC, AD (28, 29) di-skip — ALL channel summaries
      costPerConversation: parseCellNumber(r[30]),
      // AF (31) di-skip — CPR DB Google jarang dipakai
      cprDbTiktok: parseCellNumber(r[32]),
      cprRealWaMeta: parseCellNumber(r[33]),
      // AI (34) di-skip — CPR Real WA Google
      cprRealWaTiktok: parseCellNumber(r[35]),
      wac: parseCellNumber(r[36]),
      cac: parseCellNumber(r[37]),
      sac: parseCellNumber(r[38]),
      roas: parseCellNumber(r[39]),
    });
  }
  reportingCache.set(cacheKey, { rows: out, expiresAt: now + TTL_MS });
  logger.info(
    { spreadsheetId, tabName, rows: out.length },
    'sheets-reader: REPORTING loaded',
  );
  return out;
}

/** Read REPORTING untuk satu cabang spesifik. */
export async function readReportingForBranch(
  resolved: ResolvedBranch,
): Promise<ReportingRow[]> {
  return readReporting(
    resolved.business.spreadsheetId,
    resolved.reportingTab,
  );
}

// ---------- Range filter + aggregate ----------

export function filterByRange(
  rows: ReportingRow[],
  rangeStart: string,
  rangeEnd: string,
): ReportingRow[] {
  return rows.filter((r) => r.isoDate >= rangeStart && r.isoDate <= rangeEnd);
}

export interface ReportingAggregate {
  rangeStart: string;
  rangeEnd: string;
  daysWithData: number;
  // Sums (apply hanya pada cell yang BUKAN NO_DATA)
  totalAtc: { value: number | NoData; days: number };
  totalChat: { value: number | NoData; days: number };
  totalClosing: { value: number | NoData; days: number };
  totalEkor: { value: number | NoData; days: number };
  totalRevenue: { value: number | NoData; days: number };
  totalBiayaIklan: { value: number | NoData; days: number };
  // ROAS = AVERAGE per spec (BUKAN sum/sum)
  avgRoas: { value: number | NoData; days: number };
  perDayRoas: Array<{ isoDate: string; roas: number | NoData }>;
}

function sumNonNoData(
  rows: ReportingRow[],
  pick: (r: ReportingRow) => number | NoData,
): { value: number | NoData; days: number } {
  let sum = 0;
  let days = 0;
  for (const r of rows) {
    const v = pick(r);
    if (isNoData(v)) continue;
    sum += v;
    days += 1;
  }
  return { value: days > 0 ? sum : NO_DATA, days };
}

function averageNonNoData(
  rows: ReportingRow[],
  pick: (r: ReportingRow) => number | NoData,
): { value: number | NoData; days: number } {
  let sum = 0;
  let days = 0;
  for (const r of rows) {
    const v = pick(r);
    if (isNoData(v)) continue;
    sum += v;
    days += 1;
  }
  return { value: days > 0 ? sum / days : NO_DATA, days };
}

export function aggregateReporting(
  rows: ReportingRow[],
  rangeStart: string,
  rangeEnd: string,
): ReportingAggregate {
  const f = filterByRange(rows, rangeStart, rangeEnd);
  const perDayRoas: ReportingAggregate['perDayRoas'] = f.map((r) => ({
    isoDate: r.isoDate,
    roas: r.roas,
  }));
  return {
    rangeStart,
    rangeEnd,
    daysWithData: f.length,
    totalAtc: sumNonNoData(f, (r) => r.totalAtc),
    totalChat: sumNonNoData(f, (r) => r.totalChat),
    totalClosing: sumNonNoData(f, (r) => r.totalClosing),
    totalEkor: sumNonNoData(f, (r) => r.totalEkor),
    totalRevenue: sumNonNoData(f, (r) => r.revenue),
    totalBiayaIklan: sumNonNoData(f, (r) => r.totalBiayaIklan),
    avgRoas: averageNonNoData(f, (r) => r.roas),
    perDayRoas,
  };
}

// ---------- TikTok subset ----------

export interface TiktokAggregate {
  rangeStart: string;
  rangeEnd: string;
  daysWithData: number;
  totalAtc: { value: number | NoData; days: number };
  totalChat: { value: number | NoData; days: number };
  totalClosing: { value: number | NoData; days: number };
  totalBiayaTiktok: { value: number | NoData; days: number };
  totalPajakTiktok: { value: number | NoData; days: number };
  /** crTiktok, cprRealWaTiktok, atcToWaTiktok — average per spec (rasio
   *  jangan disum). */
  avgAtcToWa: { value: number | NoData; days: number };
  avgCrTiktok: { value: number | NoData; days: number };
  avgCprRealWa: { value: number | NoData; days: number };
}

export function aggregateTiktok(
  rows: ReportingRow[],
  rangeStart: string,
  rangeEnd: string,
): TiktokAggregate {
  const f = filterByRange(rows, rangeStart, rangeEnd);
  return {
    rangeStart,
    rangeEnd,
    daysWithData: f.length,
    totalAtc: sumNonNoData(f, (r) => r.atcTiktok),
    totalChat: sumNonNoData(f, (r) => r.chatTiktok),
    totalClosing: sumNonNoData(f, (r) => r.closingTiktok),
    totalBiayaTiktok: sumNonNoData(f, (r) => r.biayaTiktokRaw),
    totalPajakTiktok: sumNonNoData(f, (r) => r.pajakTiktok),
    avgAtcToWa: averageNonNoData(f, (r) => r.atcToWaTiktok),
    avgCrTiktok: averageNonNoData(f, (r) => r.crTiktok),
    avgCprRealWa: averageNonNoData(f, (r) => r.cprRealWaTiktok),
  };
}

// ---------- Helper untuk single-day fetch ----------

export function pickRowForDate(
  rows: ReportingRow[],
  isoDate: string,
): ReportingRow | null {
  return rows.find((r) => r.isoDate === isoDate) ?? null;
}
