import { logger } from '../00-foundation/index.js';
import { getSheetsClient } from './client.js';

export interface SheetRow {
  /** Raw cell value as it appears in the sheet ("2 Apr"). */
  rawDate: string;
  /** Normalized YYYY-MM-DD (current year, UTC). null if unparseable. */
  dateIso: string | null;
  metaLeads: number;
  totalChat: number;
  totalClosing: number;
  /** Column N — Total Keberangkatan (Basmalah) / Jumlah Ekor (Aqiqah). */
  totalKeberangkatan: number;
  revenue: number;
}

const MONTH_INDEX: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, mei: 4, may: 4, jun: 5, jul: 6,
  agu: 7, agt: 7, aug: 7, sep: 8, okt: 9, oct: 9, nov: 10, des: 11, dec: 11,
};

/**
 * Reads a single business tab and returns parsed rows.
 *
 * Layout assumed (header occupies rows 1-3, data starts at row 4):
 *   A = tanggal ("2 Apr")
 *   B = Meta Ads leads
 *   I = Total Chat masuk
 *   M = Total Closing
 *   O = Revenue Berjalan
 *
 * The returned rows are filtered to ones with a parseable date — empty trailing
 * rows in the sheet are dropped silently. Rows with a malformed date are
 * logged at warn and skipped.
 */
export async function readSheetData(
  spreadsheetId: string,
  sheetName: string,
): Promise<SheetRow[]> {
  const sheets = getSheetsClient();
  const range = `'${sheetName}'!A4:O`;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING',
  });

  const values = res.data.values ?? [];
  const out: SheetRow[] = [];
  const currentYear = new Date().getUTCFullYear();
  for (let i = 0; i < values.length; i++) {
    const r = values[i] ?? [];
    const rawDate = stringify(r[0]);
    if (!rawDate) continue; // empty row — end of data
    const dateIso = parseShortDate(rawDate, currentYear);
    if (!dateIso) {
      logger.warn(
        { spreadsheetId, sheetName, rowIndex: i + 4, rawDate },
        'sheets-integration: unparseable date, skipping row',
      );
      continue;
    }
    out.push({
      rawDate,
      dateIso,
      metaLeads: parseNumber(r[1]),
      totalChat: parseNumber(r[8]),
      totalClosing: parseNumber(r[12]),
      totalKeberangkatan: parseNumber(r[13]),
      revenue: parseNumber(r[14]),
    });
  }
  return out;
}

function stringify(v: unknown): string {
  if (v == null) return '';
  return String(v).trim();
}

/**
 * Parses cell shapes like "2 Apr", "24Apr", "24 apr", "24-Apr".
 * Year is taken from the caller (current UTC year). Returns YYYY-MM-DD or null.
 */
export function parseShortDate(s: string, year: number): string | null {
  const m = /^(\d{1,2})\s*[\s\-\/]?\s*([A-Za-z]+)/.exec(s.trim());
  if (!m) return null;
  const day = Number(m[1]);
  const monKey = m[2]!.toLowerCase().slice(0, 3);
  const monIdx = MONTH_INDEX[monKey];
  if (monIdx == null || day < 1 || day > 31) return null;
  return `${year}-${String(monIdx + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseNumber(v: unknown): number {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v !== 'string') return 0;
  // Handle "Rp 1.500.000" / "1,500" / plain digits.
  const cleaned = v.replace(/[^\d.\-]/g, '');
  if (!cleaned) return 0;
  // If the cleaned string has multiple dots they are thousand separators (id-ID).
  // Strip them. (Sheet revenue cells are integer rupiah — no fractional rupiah.)
  const noThousands = cleaned.includes('.') && !/^\d+\.\d+$/.test(cleaned)
    ? cleaned.replace(/\./g, '')
    : cleaned;
  const n = Number(noThousands);
  return Number.isFinite(n) ? n : 0;
}
