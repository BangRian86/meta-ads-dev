import { logger } from '../00-foundation/index.js';
import {
  BUSINESSES,
  type BusinessSheet,
  type ResolvedBranch,
} from './business-resolver.js';
import { isNoData, NO_DATA, type NoData, wibIsoDate } from './cell-utils.js';
import { loadAllCsPerform, type CsPerformRow } from './cs-data.js';
import {
  filterByRange,
  readReportingForBranch,
  type ReportingRow,
} from './reporting-data.js';

/**
 * Build compact text snapshot Sheets data untuk dikirim ke Claude sebagai
 * context. Cap window 30 hari supaya prompt tidak meledak; aggregate
 * per-CS biar tidak per-baris-per-hari.
 *
 * Data yang di-include:
 *   1. Per-cabang per-channel (Meta/Google/TikTok) summary 7 + 30 hari
 *      untuk Aqiqah PUSAT/JABAR/JATIM/JOGJA + Basmalah PUSAT
 *   2. Per-cabang per-day breakdown ringkas (last 14 hari) — supaya Claude
 *      bisa jawab pertanyaan trend
 *   3. Per-CS aggregate (chat, closing, ekor/keberangkatan, revenue) untuk
 *      window 7 + 30 hari
 *
 * Total ukuran: ~10-15KB text — jauh di bawah context window Claude.
 */

const WINDOW_LONG = 30;
const WINDOW_SHORT = 7;
const PER_DAY_TAIL = 14;

export interface SheetsAiContext {
  generatedAt: string;
  windowLongDays: number;
  windowShortDays: number;
  text: string;
}

function fmtIdr(v: number | NoData): string {
  if (isNoData(v)) return '-';
  return Math.round(v).toLocaleString('id-ID');
}

function fmtPct(v: number | NoData): string {
  if (isNoData(v)) return '-';
  const p = v <= 1 ? v * 100 : v;
  return p.toFixed(1) + '%';
}

function fmtNum(v: number | NoData): string {
  if (isNoData(v)) return '-';
  return Math.round(v).toLocaleString('id-ID');
}

function fmtRoas(v: number | NoData): string {
  if (isNoData(v)) return '-';
  return v.toFixed(2) + 'x';
}

interface SumBucket {
  totalAtcMeta: number;
  totalAtcGoogle: number;
  totalAtcTiktok: number;
  totalChatMeta: number;
  totalChatGoogle: number;
  totalChatTiktok: number;
  totalChat: number;
  totalClosingMeta: number;
  totalClosingGoogle: number;
  totalClosingTiktok: number;
  totalClosing: number;
  totalEkor: number;
  totalRevenue: number;
  totalBiayaMeta: number;
  totalBiayaGoogle: number;
  totalBiayaTiktok: number;
  totalBiayaIklan: number;
  daysSampled: number;
  roasSamples: number[];
}

function newBucket(): SumBucket {
  return {
    totalAtcMeta: 0,
    totalAtcGoogle: 0,
    totalAtcTiktok: 0,
    totalChatMeta: 0,
    totalChatGoogle: 0,
    totalChatTiktok: 0,
    totalChat: 0,
    totalClosingMeta: 0,
    totalClosingGoogle: 0,
    totalClosingTiktok: 0,
    totalClosing: 0,
    totalEkor: 0,
    totalRevenue: 0,
    totalBiayaMeta: 0,
    totalBiayaGoogle: 0,
    totalBiayaTiktok: 0,
    totalBiayaIklan: 0,
    daysSampled: 0,
    roasSamples: [],
  };
}

function addNum(target: number, v: number | NoData): number {
  return isNoData(v) ? target : target + v;
}

function aggregate(rows: ReportingRow[], since: string, until: string): SumBucket {
  const f = filterByRange(rows, since, until);
  const b = newBucket();
  for (const r of f) {
    b.totalAtcMeta = addNum(b.totalAtcMeta, r.atcMeta);
    b.totalAtcGoogle = addNum(b.totalAtcGoogle, r.atcGoogle);
    b.totalAtcTiktok = addNum(b.totalAtcTiktok, r.atcTiktok);
    b.totalChatMeta = addNum(b.totalChatMeta, r.chatMeta);
    b.totalChatGoogle = addNum(b.totalChatGoogle, r.chatGoogle);
    b.totalChatTiktok = addNum(b.totalChatTiktok, r.chatTiktok);
    b.totalChat = addNum(b.totalChat, r.totalChat);
    b.totalClosingMeta = addNum(b.totalClosingMeta, r.closingMeta);
    b.totalClosingGoogle = addNum(b.totalClosingGoogle, r.closingGoogle);
    b.totalClosingTiktok = addNum(b.totalClosingTiktok, r.closingTiktok);
    b.totalClosing = addNum(b.totalClosing, r.totalClosing);
    b.totalEkor = addNum(b.totalEkor, r.totalEkor);
    b.totalRevenue = addNum(b.totalRevenue, r.revenue);
    b.totalBiayaMeta = addNum(b.totalBiayaMeta, r.biayaMetaRaw);
    b.totalBiayaGoogle = addNum(b.totalBiayaGoogle, r.biayaGoogleRaw);
    b.totalBiayaTiktok = addNum(b.totalBiayaTiktok, r.biayaTiktokRaw);
    b.totalBiayaIklan = addNum(b.totalBiayaIklan, r.totalBiayaIklan);
    if (!isNoData(r.roas)) {
      b.roasSamples.push(r.roas);
    }
    b.daysSampled += 1;
  }
  return b;
}

function avg(samples: number[]): number | NoData {
  if (samples.length === 0) return NO_DATA;
  return samples.reduce((a, b) => a + b, 0) / samples.length;
}

function renderBranchBlock(
  resolved: ResolvedBranch,
  rows: ReportingRow[],
  longSince: string,
  shortSince: string,
  todayIso: string,
): string {
  const lines: string[] = [];
  lines.push(
    `BRANCH: ${resolved.business.label} - ${resolved.branch} (tab "${resolved.reportingTab}")`,
  );

  const long = aggregate(rows, longSince, todayIso);
  const short = aggregate(rows, shortSince, todayIso);

  const fmtBucket = (label: string, b: SumBucket): string[] => [
    `  [${label}] ${b.daysSampled} hari ada data`,
    `    ATC iklan: Meta=${fmtNum(b.totalAtcMeta)} Google=${fmtNum(b.totalAtcGoogle)} TikTok=${fmtNum(b.totalAtcTiktok)}`,
    `    Real chat: Meta=${fmtNum(b.totalChatMeta)} Google=${fmtNum(b.totalChatGoogle)} TikTok=${fmtNum(b.totalChatTiktok)} TOTAL=${fmtNum(b.totalChat)}`,
    `    Closing: Meta=${fmtNum(b.totalClosingMeta)} Google=${fmtNum(b.totalClosingGoogle)} TikTok=${fmtNum(b.totalClosingTiktok)} TOTAL=${fmtNum(b.totalClosing)} Ekor=${fmtNum(b.totalEkor)}`,
    `    Revenue: Rp ${fmtIdr(b.totalRevenue)}`,
    `    Biaya iklan: Meta=Rp ${fmtIdr(b.totalBiayaMeta)} Google=Rp ${fmtIdr(b.totalBiayaGoogle)} TikTok=Rp ${fmtIdr(b.totalBiayaTiktok)} TOTAL=Rp ${fmtIdr(b.totalBiayaIklan)}`,
    `    ROAS rata-rata harian: ${fmtRoas(avg(b.roasSamples))} (${b.roasSamples.length} sample)`,
  ];

  lines.push(...fmtBucket(`LAST ${WINDOW_LONG}d`, long));
  lines.push(...fmtBucket(`LAST ${WINDOW_SHORT}d`, short));

  // Per-day tail (untuk trend questions). Cap to 14 baris terakhir dengan data.
  const tail = filterByRange(rows, longSince, todayIso).slice(-PER_DAY_TAIL);
  if (tail.length > 0) {
    lines.push(`  PER-DAY (last ${tail.length} hari):`);
    for (const r of tail) {
      lines.push(
        `    ${r.isoDate}: chat=${fmtNum(r.totalChat)} closing=${fmtNum(r.totalClosing)} rev=${fmtIdr(r.revenue)} biaya=${fmtIdr(r.totalBiayaIklan)} ROAS=${fmtRoas(r.roas)}`,
      );
    }
  }
  return lines.join('\n');
}

interface CsAgg {
  business: string;
  contextLabel: string;
  csName: string;
  branch: string;
  totalChat: number;
  totalClosing: number;
  totalEkor: number;
  totalRevenue: number;
  totalBiayaCs: number;
  daysWithData: number;
}

function aggregateCsForWindow(
  all: CsPerformRow[],
  since: string,
  until: string,
): CsAgg[] {
  const buckets = new Map<string, CsAgg>();
  for (const r of all) {
    if (r.isoDate < since || r.isoDate > until) continue;
    const key = `${r.business}::${r.csName}`;
    let b = buckets.get(key);
    if (!b) {
      b = {
        business: r.business,
        contextLabel: r.contextLabel,
        csName: r.csName,
        branch: r.branch,
        totalChat: 0,
        totalClosing: 0,
        totalEkor: 0,
        totalRevenue: 0,
        totalBiayaCs: 0,
        daysWithData: 0,
      };
      buckets.set(key, b);
    }
    let any = false;
    if (!isNoData(r.chat)) {
      b.totalChat += r.chat;
      any = true;
    }
    if (!isNoData(r.closing)) {
      b.totalClosing += r.closing;
      any = true;
    }
    if (!isNoData(r.ekor)) {
      b.totalEkor += r.ekor;
      any = true;
    }
    if (!isNoData(r.revenue)) {
      b.totalRevenue += r.revenue;
      any = true;
    }
    if (!isNoData(r.biayaPerCs)) {
      b.totalBiayaCs += r.biayaPerCs;
      any = true;
    }
    if (any) b.daysWithData += 1;
  }
  // Sort by revenue desc — ranking-relevant.
  return [...buckets.values()].sort((a, b) => b.totalRevenue - a.totalRevenue);
}

function renderCsBlock(
  windowLabel: string,
  rows: CsAgg[],
): string {
  if (rows.length === 0) return '';
  const lines: string[] = [`CS PERFORMANCE [${windowLabel}]:`];
  for (const r of rows) {
    const cr = r.totalChat > 0 ? (r.totalClosing / r.totalChat) * 100 : 0;
    lines.push(
      `  ${r.csName} (${r.contextLabel}${r.branch ? ' - ' + r.branch : ''}) chat=${fmtNum(r.totalChat)} closing=${fmtNum(r.totalClosing)} ekor=${fmtNum(r.totalEkor)} revenue=Rp ${fmtIdr(r.totalRevenue)} biaya=Rp ${fmtIdr(r.totalBiayaCs)} CR=${cr.toFixed(1)}% days=${r.daysWithData}`,
    );
  }
  return lines.join('\n');
}

function isoOffset(daysBack: number): string {
  return wibIsoDate(-daysBack);
}

/**
 * Build context dari semua tab yang relevan. Pull paralel per-branch
 * supaya total wallclock reasonable (~3-5 detik dengan 5 cabang Aqiqah +
 * 1 cabang Basmalah + 2 CS PERFORM tabs).
 */
export async function buildSheetsAiContext(): Promise<SheetsAiContext> {
  const today = wibIsoDate();
  const longSince = isoOffset(WINDOW_LONG - 1);
  const shortSince = isoOffset(WINDOW_SHORT - 1);

  const branchPromises: Array<Promise<string>> = [];
  for (const biz of BUSINESSES) {
    for (const b of biz.branches) {
      const resolved: ResolvedBranch = {
        business: biz,
        branch: b.branch,
        reportingTab: b.reportingTab,
      };
      branchPromises.push(
        readReportingForBranch(resolved)
          .then((rows) =>
            renderBranchBlock(resolved, rows, longSince, shortSince, today),
          )
          .catch((err) => {
            logger.warn(
              { err, branch: b.branch, business: biz.business },
              'sheets-ai-context: branch read failed',
            );
            return `BRANCH: ${biz.label} - ${b.branch} (READ FAILED — abaikan untuk pertanyaan ini)`;
          }),
      );
    }
  }

  const csPromise = loadAllCsPerform().catch((err) => {
    logger.warn({ err }, 'sheets-ai-context: CS PERFORM read failed');
    return [] as CsPerformRow[];
  });

  const [branchBlocks, csAll] = await Promise.all([
    Promise.all(branchPromises),
    csPromise,
  ]);

  const csLong = aggregateCsForWindow(csAll, longSince, today);
  const csShort = aggregateCsForWindow(csAll, shortSince, today);

  const sections: string[] = [];
  sections.push(
    `Snapshot data Google Sheets — generated ${today} (WIB)\n` +
      `Windows: SHORT=${WINDOW_SHORT}d, LONG=${WINDOW_LONG}d. Per-day tail = last ${PER_DAY_TAIL} hari.`,
  );
  sections.push(...branchBlocks);
  sections.push(renderCsBlock(`LAST ${WINDOW_LONG}d`, csLong));
  sections.push(renderCsBlock(`LAST ${WINDOW_SHORT}d`, csShort));

  return {
    generatedAt: today,
    windowLongDays: WINDOW_LONG,
    windowShortDays: WINDOW_SHORT,
    text: sections.filter((s) => s.length > 0).join('\n\n────────────────\n\n'),
  };
}
