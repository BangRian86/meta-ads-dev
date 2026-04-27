/**
 * Tahap 1 — DISCOVERY (READ-ONLY).
 *
 * Tujuan: dokumentasikan SEMUA spreadsheet + tab yang accessible oleh
 * service account. Tidak modify apa-apa, tidak bangun command apa-apa.
 *
 * Output: discovery report ke stdout (caller routes ke Telegram bila perlu).
 *
 * Scope: drive.metadata.readonly (list files) + spreadsheets.readonly
 * (read tabs/cells). Auth-nya BEDA dari production sheets-client supaya
 * scope production tetap minimal.
 */
import { google } from 'googleapis';
import { appConfig as config } from '../src/modules/00-foundation/index.js';
import { closeDb } from '../src/modules/00-foundation/index.js';
import { SHEET_SOURCES } from '../src/modules/13-sheets-integration/index.js';

/** Spreadsheet IDs yang sudah hardcoded di codebase. Dipakai sebagai
 *  fallback kalau Drive API belum di-enable di GCP project. */
const KNOWN_SPREADSHEET_IDS = Array.from(
  new Set(SHEET_SOURCES.map((s) => s.spreadsheetId)),
);

interface SpreadsheetMeta {
  id: string;
  name: string;
  modifiedTime: string;
  owners: string[];
}

interface TabSnapshot {
  title: string;
  sheetId: number;
  rowCount: number;
  columnCount: number;
  /** Raw header row values (col A..Z), cleaned. */
  headers: string[];
  /** First few data rows after the header. */
  sampleRows: string[][];
  /** Columns that contain at least one formula in the sampled rows. */
  formulaColumns: Array<{ col: string; sample: string }>;
  /** Best guess at where data starts (1-indexed Sheets row). */
  headerRow: number;
}

const HEADER_PROBE_RANGE = 'A1:Z6';
const FORMULA_PROBE_RANGE = 'A1:Z6';

function makeAuth() {
  return new google.auth.GoogleAuth({
    keyFile: config.google.credentialsPath,
    scopes: [
      'https://www.googleapis.com/auth/drive.metadata.readonly',
      'https://www.googleapis.com/auth/spreadsheets.readonly',
    ],
  });
}

async function listAccessibleSpreadsheets(): Promise<SpreadsheetMeta[]> {
  const drive = google.drive({ version: 'v3', auth: makeAuth() });
  const out: SpreadsheetMeta[] = [];
  let pageToken: string | undefined;
  do {
    const res = await drive.files.list({
      q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
      // includeItemsFromAllDrives + supportsAllDrives so we can also see
      // shared-drive files the SA was added to.
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      corpora: 'allDrives',
      pageSize: 100,
      ...(pageToken !== undefined ? { pageToken } : {}),
      fields:
        'nextPageToken, files(id, name, modifiedTime, owners(emailAddress))',
    });
    for (const f of res.data.files ?? []) {
      out.push({
        id: f.id ?? '',
        name: f.name ?? '(untitled)',
        modifiedTime: f.modifiedTime ?? '',
        owners: (f.owners ?? []).map((o) => o.emailAddress ?? '').filter(Boolean),
      });
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

async function inspectSpreadsheet(
  spreadsheetId: string,
): Promise<{ tabs: TabSnapshot[]; error?: string }> {
  const sheets = google.sheets({ version: 'v4', auth: makeAuth() });
  let meta;
  try {
    meta = await sheets.spreadsheets.get({
      spreadsheetId,
      fields:
        'sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))',
    });
  } catch (err) {
    return {
      tabs: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
  const tabs: TabSnapshot[] = [];
  const sheetList = meta.data.sheets ?? [];

  // Batch read header+sample for each tab. valueRenderOption=FORMATTED_VALUE
  // shows numbers as Sheets renders them ("Rp 1.500.000"). We do a SECOND
  // batch with FORMULA so we know which cells are computed.
  const tabTitles = sheetList
    .map((s) => s.properties?.title ?? '')
    .filter((t) => t.length > 0);
  if (tabTitles.length === 0) return { tabs: [] };

  const ranges = tabTitles.map((t) => `'${t.replace(/'/g, "''")}'!${HEADER_PROBE_RANGE}`);
  const formulaRanges = tabTitles.map(
    (t) => `'${t.replace(/'/g, "''")}'!${FORMULA_PROBE_RANGE}`,
  );

  let valuesRes;
  let formulaRes;
  try {
    [valuesRes, formulaRes] = await Promise.all([
      sheets.spreadsheets.values.batchGet({
        spreadsheetId,
        ranges,
        valueRenderOption: 'FORMATTED_VALUE',
      }),
      sheets.spreadsheets.values.batchGet({
        spreadsheetId,
        ranges: formulaRanges,
        valueRenderOption: 'FORMULA',
      }),
    ]);
  } catch (err) {
    return {
      tabs: [],
      error:
        'batchGet failed: ' +
        (err instanceof Error ? err.message : String(err)),
    };
  }

  const valueRanges = valuesRes.data.valueRanges ?? [];
  const formulaValueRanges = formulaRes.data.valueRanges ?? [];

  for (let i = 0; i < sheetList.length; i += 1) {
    const props = sheetList[i]?.properties;
    if (!props) continue;
    const grid = props.gridProperties;
    const rows = (valueRanges[i]?.values ?? []) as string[][];
    const formulaRows = (formulaValueRanges[i]?.values ?? []) as string[][];

    // Header detection: first non-empty row is treated as the header.
    let headerRowIdx = 0;
    while (
      headerRowIdx < rows.length &&
      rows[headerRowIdx]!.every((v) => v == null || v === '')
    ) {
      headerRowIdx += 1;
    }
    const headers = rows[headerRowIdx] ?? [];
    const sampleRows = rows.slice(headerRowIdx + 1, headerRowIdx + 4);

    const formulaColumns: TabSnapshot['formulaColumns'] = [];
    for (let r = 0; r < formulaRows.length; r += 1) {
      const row = formulaRows[r] ?? [];
      for (let c = 0; c < row.length; c += 1) {
        const v = row[c];
        if (typeof v === 'string' && v.startsWith('=')) {
          const colLetter = colLetterFor(c);
          if (!formulaColumns.find((f) => f.col === colLetter)) {
            formulaColumns.push({ col: colLetter, sample: v });
          }
        }
      }
    }

    tabs.push({
      title: props.title ?? '',
      sheetId: props.sheetId ?? 0,
      rowCount: grid?.rowCount ?? 0,
      columnCount: grid?.columnCount ?? 0,
      headers: headers.map((h) => String(h ?? '').trim()),
      sampleRows: sampleRows.map((row) => row.map((c) => String(c ?? '').trim())),
      formulaColumns,
      headerRow: headerRowIdx + 1,
    });
  }
  return { tabs };
}

function colLetterFor(zeroIndex: number): string {
  // 0 → A, 1 → B, ..., 25 → Z, 26 → AA. Cukup buat A..Z (kita probe sampai Z).
  let n = zeroIndex;
  let s = '';
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

function fmtTab(tab: TabSnapshot): string {
  const lines: string[] = [];
  lines.push(`  📋 ${tab.title}  (${tab.rowCount} rows × ${tab.columnCount} cols)`);
  if (tab.headers.length === 0 || tab.headers.every((h) => h === '')) {
    lines.push(`     (no header detected in A1:Z6)`);
    return lines.join('\n');
  }
  lines.push(`     header (row ${tab.headerRow}):`);
  tab.headers.forEach((h, i) => {
    if (!h) return;
    const col = colLetterFor(i);
    const formula = tab.formulaColumns.find((f) => f.col === col);
    const note = formula ? ` ← formula (${truncate(formula.sample, 50)})` : '';
    lines.push(`       ${col}: ${truncate(h, 60)}${note}`);
  });
  if (tab.sampleRows.length > 0) {
    lines.push(`     sample data (first ${tab.sampleRows.length} row(s) below header):`);
    for (const row of tab.sampleRows) {
      const preview = row
        .slice(0, 8)
        .map((c) => truncate(c, 18))
        .join(' | ');
      lines.push(`       ${truncate(preview, 140)}`);
    }
  }
  return lines.join('\n');
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

async function main(): Promise<number> {
  const t0 = Date.now();
  console.log('🔍 Tahap 1 — DISCOVERY (read-only)');
  console.log('Service account credentials:', config.google.credentialsPath);

  console.log('\nListing all accessible spreadsheets via Drive API…');
  let spreadsheets: SpreadsheetMeta[];
  let driveListError: string | null = null;
  try {
    spreadsheets = await listAccessibleSpreadsheets();
  } catch (err) {
    driveListError = err instanceof Error ? err.message : String(err);
    console.warn(
      '⚠️  Drive API tidak available:',
      truncate(driveListError, 200),
    );
    console.warn(
      '   Fallback ke ID spreadsheet yang sudah di-hardcode di codebase.\n',
    );
    // Best-effort: pull metadata via Sheets API per known ID so we still
    // get name + tab listings. modifiedTime/owners tidak available via
    // Sheets API → biarkan kosong.
    spreadsheets = [];
    const sheetsApi = google.sheets({ version: 'v4', auth: makeAuth() });
    for (const id of KNOWN_SPREADSHEET_IDS) {
      try {
        const meta = await sheetsApi.spreadsheets.get({
          spreadsheetId: id,
          fields: 'properties(title)',
        });
        spreadsheets.push({
          id,
          name: meta.data.properties?.title ?? '(untitled)',
          modifiedTime: '(unknown — Drive API disabled)',
          owners: [],
        });
      } catch (err) {
        spreadsheets.push({
          id,
          name: `❌ inaccessible (${err instanceof Error ? err.message.slice(0, 80) : 'error'})`,
          modifiedTime: '',
          owners: [],
        });
      }
    }
  }

  console.log(`\n📁 Spreadsheets accessible: ${spreadsheets.length}`);
  for (let i = 0; i < spreadsheets.length; i += 1) {
    const s = spreadsheets[i]!;
    console.log(
      `  ${i + 1}. ${s.name}  (id ${s.id})`,
    );
    console.log(
      `     modified: ${s.modifiedTime}` +
        (s.owners.length > 0 ? `  owners: ${s.owners.join(', ')}` : ''),
    );
  }

  if (spreadsheets.length === 0) {
    console.log(
      '\n⚠️  Service account melihat 0 spreadsheet. Pastikan ' +
        'spreadsheet sudah di-share ke email service account.',
    );
    return 0;
  }

  console.log('\n📊 INSPECTING TABS…\n');
  for (const s of spreadsheets) {
    console.log(`══════════════════════════════════════════════════════════`);
    console.log(`📁 ${s.name}`);
    console.log(`   id: ${s.id}`);
    console.log(`══════════════════════════════════════════════════════════`);
    const { tabs, error } = await inspectSpreadsheet(s.id);
    if (error) {
      console.log(`  ❌ ${error}`);
      continue;
    }
    if (tabs.length === 0) {
      console.log(`  (no tabs found)`);
      continue;
    }
    console.log(`  ${tabs.length} tab(s):\n`);
    for (const t of tabs) {
      console.log(fmtTab(t));
      console.log('');
    }
  }

  // ─────────── Summary (compact, dipakai buat ringkasan akhir) ───────────
  console.log(`\n${'═'.repeat(60)}`);
  console.log('🔍 SHEETS DISCOVERY SUMMARY');
  console.log('═'.repeat(60));
  console.log(`Generated: ${new Date().toISOString()}`);
  console.log(`Took: ${Date.now() - t0}ms`);
  console.log(`Spreadsheets: ${spreadsheets.length}`);
  for (const s of spreadsheets) {
    console.log(`  • ${s.name}`);
  }
  if (driveListError !== null) {
    console.log(
      `\n⚠️  Drive API NOT enabled di GCP project — discovery cuma ` +
        `cover ${spreadsheets.length} spreadsheet yang ID-nya udah ` +
        `di-hardcode di codebase. Kalau ada spreadsheet lain di luar ` +
        `2 ini, perlu enable Drive API dulu di GCP console.`,
    );
  }
  console.log(
    '\n➡️  Output di atas = data mentah buat dianalisa.\n' +
      '   Reply dengan konfirmasi/koreksi sebelum lanjut ke Tahap 2 (build commands).',
  );

  return 0;
}

let exitCode = 0;
try {
  exitCode = await main();
} catch (err) {
  console.error('CRASH:', err);
  exitCode = 1;
} finally {
  await closeDb();
}
process.exit(exitCode);
