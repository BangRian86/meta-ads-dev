import { logger } from '../00-foundation/index.js';
import {
  BUSINESSES,
  type Business,
  type BusinessSheet,
} from './business-resolver.js';
import { parseCellNumber, parseCellString, isNoData } from './cell-utils.js';
import { getReadClient } from './sheets-client.js';

export type AlertMetric = 'ROAS' | 'CR%' | 'CPR' | 'CAC' | 'SAC';

export interface AlertConfigRow {
  business: Business;
  /** Cabang spesifik atau '*' untuk semua. */
  branch: string;
  metric: AlertMetric;
  kritis: number;
  warning: number;
  active: boolean;
}

export interface AlertConfigResult {
  rows: AlertConfigRow[];
  /** Spreadsheet yang TIDAK punya tab ALERT_CONFIG. Bot tidak akan coba
   *  auto-create — service account read-only sesuai keputusan operator.
   *  Operator perlu buat tab manual (lihat instructions di /alert output). */
  missingTab: Array<{ business: Business; spreadsheetId: string }>;
}

/**
 * Tab name di Sheet user pakai suffix business: "ALERT_CONFIG_Aqiqah" /
 * "ALERT_CONFIG_Basmalah". Title-case di-derive dari business string.
 */
function alertTabName(business: Business): string {
  const titleCase = business.charAt(0).toUpperCase() + business.slice(1);
  return `ALERT_CONFIG_${titleCase}`;
}

/**
 * Layout tab ALERT_CONFIG yang Bang Rian setup manual:
 *   Row 1: Title (merged) — "ALERT_CONFIG — [Business]"
 *   Row 2: Description (merged)
 *   Row 3: kosong (separator)
 *   Row 4: Header — Bisnis | Cabang | Metric | Kritis | Warning | Active
 *   Row 5+: Data rows (parsed sampai ketemu separator)
 *   Row N+: Notes section (start dengan "📖 PANDUAN PENGGUNAAN:")
 *
 * Range A4:F mengambil header + semua data; parser stop di row pertama
 * yang qualify sebagai end-of-data (lihat parseConfigRows).
 */
const READ_RANGE = 'A4:F';

export async function loadAllAlertConfigs(): Promise<AlertConfigResult> {
  const missingTab: AlertConfigResult['missingTab'] = [];
  const rows: AlertConfigRow[] = [];
  for (const biz of BUSINESSES) {
    const r = await loadConfigForBusiness(biz);
    if (r.outcome === 'missing_tab') {
      missingTab.push({
        business: biz.business,
        spreadsheetId: biz.spreadsheetId,
      });
    }
    rows.push(...r.rows);
  }
  return { rows, missingTab };
}

type LoadOutcome = 'read' | 'missing_tab' | 'failed';

async function loadConfigForBusiness(
  biz: BusinessSheet,
): Promise<{ rows: AlertConfigRow[]; outcome: LoadOutcome }> {
  const tab = alertTabName(biz.business);
  try {
    const sheets = getReadClient();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: biz.spreadsheetId,
      range: `'${tab}'!${READ_RANGE}`,
      valueRenderOption: 'UNFORMATTED_VALUE',
    });
    const raw = (res.data.values ?? []) as unknown[][];
    const parsed = parseConfigRows(biz.business, raw);
    if (!parsed.headerOk) {
      logger.warn(
        {
          spreadsheetId: biz.spreadsheetId,
          business: biz.business,
          headerSeen: parsed.headerSeen,
        },
        'alert-config: header row 4 tidak match Bisnis|Cabang|Metric|Kritis|Warning|Active — skipping',
      );
      return { rows: [], outcome: 'failed' };
    }
    return { rows: parsed.rows, outcome: 'read' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (isMissingTabError(msg)) {
      logger.info(
        { spreadsheetId: biz.spreadsheetId, business: biz.business },
        'alert-config: ALERT_CONFIG tab tidak ada — skip business ini',
      );
      return { rows: [], outcome: 'missing_tab' };
    }
    logger.error(
      { err, spreadsheetId: biz.spreadsheetId },
      'alert-config: read failed (non-missing-tab)',
    );
    return { rows: [], outcome: 'failed' };
  }
}

function isMissingTabError(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes('unable to parse range') ||
    m.includes('not found') ||
    m.includes('no grid') ||
    m.includes("doesn't exist")
  );
}

interface ParseResult {
  headerOk: boolean;
  headerSeen: string[];
  rows: AlertConfigRow[];
}

const EXPECTED_HEADER = ['bisnis', 'cabang', 'metric', 'kritis', 'warning', 'active'];

function parseConfigRows(business: Business, raw: unknown[][]): ParseResult {
  // Row 0 (sheet row 4) = header. Validate it loosely (case-insensitive,
  // tolerate extra whitespace / trailing columns).
  const headerRow = (raw[0] ?? []).map((c) => parseCellString(c).toLowerCase());
  const headerOk = EXPECTED_HEADER.every((expected, i) => headerRow[i] === expected);
  if (!headerOk) {
    return { headerOk: false, headerSeen: headerRow, rows: [] };
  }

  const rows: AlertConfigRow[] = [];
  for (let i = 1; i < raw.length; i += 1) {
    const r = raw[i] ?? [];
    if (isEndOfDataRow(r)) break;
    const businessCell = parseCellString(r[0]).toLowerCase();
    if (businessCell !== business) {
      // Defensive: tab di Sheet aqiqah tidak boleh punya row 'basmalah'
      // (atau sebaliknya). Kalau mismatch, skip diam-diam.
      continue;
    }
    const branch = (parseCellString(r[1]) || '*').toUpperCase();
    const metric = parseMetric(parseCellString(r[2]).toUpperCase());
    if (!metric) continue;
    const kritis = parseCellNumber(r[3]);
    const warning = parseCellNumber(r[4]);
    if (isNoData(kritis) || isNoData(warning)) continue;
    const activeCell = parseCellString(r[5]).toUpperCase();
    const active =
      activeCell === 'TRUE' || activeCell === 'YA' || activeCell === '1' || activeCell === 'Y';
    rows.push({ business, branch, metric, kritis, warning, active });
  }
  return { headerOk: true, headerSeen: headerRow, rows };
}

/**
 * Row dianggap akhir-dari-data kalau:
 *   - Semua cell kosong (separator antara data & notes), ATAU
 *   - Cell A start dengan emoji 📖 (header notes section), ATAU
 *   - Cell A bukan nama bisnis valid (lazy stop — tahan terhadap notes
 *     tambahan yang di-paste user di bawah data).
 */
function isEndOfDataRow(r: unknown[]): boolean {
  const cells = r.map((c) => parseCellString(c));
  if (cells.every((c) => c === '')) return true;
  const first = cells[0] ?? '';
  if (first.startsWith('📖')) return true;
  const lower = first.toLowerCase();
  if (lower !== 'aqiqah' && lower !== 'basmalah') return true;
  return false;
}

function parseMetric(s: string): AlertMetric | null {
  if (s === 'ROAS') return 'ROAS';
  if (s === 'CR%' || s === 'CR') return 'CR%';
  if (s === 'CPR') return 'CPR';
  if (s === 'CAC') return 'CAC';
  if (s === 'SAC') return 'SAC';
  return null;
}

/**
 * Resolve config row yang relevan untuk (business, branch, metric).
 * Branch-spesifik menang dari wildcard '*' kalau dua-duanya ada — user
 * override per-cabang manual.
 */
export function findActiveConfig(
  configs: AlertConfigRow[],
  business: Business,
  branch: string,
  metric: AlertMetric,
): AlertConfigRow | null {
  const branchUpper = branch.toUpperCase();
  const exact = configs.find(
    (c) =>
      c.business === business &&
      c.metric === metric &&
      c.branch === branchUpper &&
      c.active,
  );
  if (exact) return exact;
  const wildcard = configs.find(
    (c) =>
      c.business === business &&
      c.metric === metric &&
      c.branch === '*' &&
      c.active,
  );
  return wildcard ?? null;
}
