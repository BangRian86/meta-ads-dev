import { logger } from '../../lib/logger.js';
import { parseShortDate, readSheetData, type SheetRow } from './reader.js';

export type BusinessKind = 'basmalah' | 'aqiqah';

export interface SheetSource {
  /** Heading shown in the report. */
  label: string;
  spreadsheetId: string;
  tab: string;
  /** Drives whether column N renders as "Total Jamaah" (basmalah) or
   *  "Jumlah Ekor" (aqiqah), and which subtotal it feeds. */
  kind: BusinessKind;
}

/**
 * Hardcoded mapping from operator's two spreadsheets to the 5 business tabs.
 * Order here is the order rendered in the daily report.
 */
export const SHEET_SOURCES: readonly SheetSource[] = [
  {
    label: 'BASMALAH TRAVEL',
    spreadsheetId: '1z6hCUAvzoTHwcmI9Sg3bN2VmEIhPw6cvCTGZYhBHIwE',
    // Actual tab in the Basmalah spreadsheet is "PUSAT - REPORTING"; the
    // operator abbreviated to "PUSAT - REP" in the spec but the API needs
    // the exact tab title.
    tab: 'PUSAT - REPORTING',
    kind: 'basmalah',
  },
  {
    label: 'AQIQAH EXPRESS - PUSAT',
    spreadsheetId: '1KES1HBKuR7fXgfYV7c5b2tYcsazahcu08gH_Aibdh7c',
    tab: 'PUSAT - REPORTING',
    kind: 'aqiqah',
  },
  {
    label: 'AQIQAH EXPRESS - JABAR',
    spreadsheetId: '1KES1HBKuR7fXgfYV7c5b2tYcsazahcu08gH_Aibdh7c',
    tab: 'JABAR - REPORTING',
    kind: 'aqiqah',
  },
  {
    label: 'AQIQAH EXPRESS - JATIM',
    spreadsheetId: '1KES1HBKuR7fXgfYV7c5b2tYcsazahcu08gH_Aibdh7c',
    tab: 'JATIM - REPORTING',
    kind: 'aqiqah',
  },
  {
    label: 'AQIQAH EXPRESS - JOGJA',
    spreadsheetId: '1KES1HBKuR7fXgfYV7c5b2tYcsazahcu08gH_Aibdh7c',
    tab: 'JOGJA - REPORTING',
    kind: 'aqiqah',
  },
];

export interface SectionData {
  source: SheetSource;
  row: SheetRow | null; // null = no row matched the target date
}

export interface SectionError {
  source: SheetSource;
  message: string;
}

export interface DailyReport {
  /** YYYY-MM-DD the report represents. */
  targetDate: string;
  sections: SectionData[];
  errors: SectionError[];
}

/** Returns yesterday's date (UTC) as YYYY-MM-DD. */
export function isoYesterday(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Accepts user-typed date arguments like "24Apr", "24 Apr", "2026-04-24".
 * Returns YYYY-MM-DD using the current UTC year for short forms.
 */
export function normalizeDateArg(arg: string): string | null {
  const s = arg.trim();
  // ISO already.
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return parseShortDate(s, new Date().getUTCFullYear());
}

export async function getReportForDate(targetDate: string): Promise<DailyReport> {
  const sections: SectionData[] = [];
  const errors: SectionError[] = [];

  for (const source of SHEET_SOURCES) {
    try {
      const rows = await readSheetData(source.spreadsheetId, source.tab);
      const row = rows.find((r) => r.dateIso === targetDate) ?? null;
      sections.push({ source, row });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(
        { err, spreadsheetId: source.spreadsheetId, tab: source.tab },
        'sheets-integration: failed to read tab',
      );
      errors.push({ source, message });
      sections.push({ source, row: null });
    }
  }

  return { targetDate, sections, errors };
}

export async function getYesterdayReport(): Promise<DailyReport> {
  return getReportForDate(isoYesterday());
}

const MONTH_ID = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'Mei',
  'Jun',
  'Jul',
  'Agu',
  'Sep',
  'Okt',
  'Nov',
  'Des',
];

/** "2026-04-24" → "24 Apr 2026". */
function formatHumanDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  const monIdx = Number(m) - 1;
  const monLabel = MONTH_ID[monIdx] ?? m;
  return `${Number(d)} ${monLabel} ${y}`;
}

function fmtIdr(n: number): string {
  return 'Rp ' + Math.round(n).toLocaleString('id-ID');
}

const LABEL_WIDTH = 14;

function row(label: string, value: string | number): string {
  return `${label.padEnd(LABEL_WIDTH, ' ')}: ${value}`;
}

/** Per-kind label for the column-N metric. */
function keberangkatanLabel(kind: BusinessKind): string {
  return kind === 'basmalah' ? 'Total Jamaah' : 'Jumlah Ekor';
}

export interface DailyReportRoasRow {
  label: string;
  spendIdr: number;
  revenueIdr: number;
  closingQuantity: number;
  unit: string;
  roas: number;
}

export interface DailyReportExtras {
  /** Optional per-source ROAS lines appended below the totals block. The
   *  caller computes spend (from Meta insights) and pairs it with the
   *  sheet's revenue so we don't introduce a circular dep on module 02. */
  roas?: DailyReportRoasRow[];
}

export function buildDailyReport(
  report: DailyReport,
  extras: DailyReportExtras = {},
): string {
  const lines: string[] = [];
  lines.push(`LAPORAN PAGI ${formatHumanDate(report.targetDate)}`);
  lines.push('');

  let totalLeads = 0;
  let totalChat = 0;
  let totalClosing = 0;
  let totalJamaah = 0; // Basmalah only
  let totalEkor = 0; // Aqiqah only
  let totalRevenue = 0;
  let anyData = false;

  for (const sec of report.sections) {
    lines.push(sec.source.label);
    if (sec.row == null) {
      lines.push('(Tidak ada data untuk tanggal ini.)');
    } else {
      anyData = true;
      lines.push(row('Leads Meta', sec.row.metaLeads));
      lines.push(row('Total Chat', sec.row.totalChat));
      lines.push(row('Total Closing', sec.row.totalClosing));
      lines.push(row(keberangkatanLabel(sec.source.kind), sec.row.totalKeberangkatan));
      lines.push(row('Revenue', fmtIdr(sec.row.revenue)));
      totalLeads += sec.row.metaLeads;
      totalChat += sec.row.totalChat;
      totalClosing += sec.row.totalClosing;
      totalRevenue += sec.row.revenue;
      if (sec.source.kind === 'basmalah') totalJamaah += sec.row.totalKeberangkatan;
      else totalEkor += sec.row.totalKeberangkatan;
    }
    lines.push('');
  }

  lines.push('TOTAL SEMUA BISNIS');
  if (!anyData) {
    lines.push('(Tidak ada data untuk tanggal ini di seluruh sheet.)');
  } else {
    lines.push(row('Total Leads', totalLeads));
    lines.push(row('Total Chat', totalChat));
    lines.push(row('Total Closing', totalClosing));
    lines.push(row('Total Jamaah', `${totalJamaah} (Basmalah saja)`));
    lines.push(row('Total Ekor', `${totalEkor} (Aqiqah saja)`));
    lines.push(row('Total Revenue', fmtIdr(totalRevenue)));
  }

  if (extras.roas && extras.roas.length > 0) {
    lines.push('');
    lines.push('ROAS PER AKUN');
    let totalSpend = 0;
    let totalRev = 0;
    for (const r of extras.roas) {
      const roasStr = r.roas > 0 ? `${r.roas.toFixed(2)}x` : '—';
      lines.push(
        `${r.label}: ${roasStr} (spend ${fmtIdr(r.spendIdr)} / rev ${fmtIdr(r.revenueIdr)} / ${r.closingQuantity} ${r.unit})`,
      );
      totalSpend += r.spendIdr;
      totalRev += r.revenueIdr;
    }
    const totalRoas = totalSpend > 0 ? totalRev / totalSpend : 0;
    const totalRoasStr = totalRoas > 0 ? `${totalRoas.toFixed(2)}x` : '—';
    lines.push(
      `TOTAL: ${totalRoasStr} (spend ${fmtIdr(totalSpend)} / rev ${fmtIdr(totalRev)})`,
    );
  }

  if (report.errors.length > 0) {
    lines.push('');
    lines.push('Error sheet:');
    for (const e of report.errors) {
      lines.push(`- ${e.source.label} (${e.source.tab}): ${e.message}`);
    }
  }

  return lines.join('\n');
}
