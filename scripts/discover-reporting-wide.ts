/**
 * Targeted probe: PUSAT-REPORTING tabs in both spreadsheets, full width
 * (A1:BI6) so we can find where ROAS / CPL / etc. live in the 61-col layout.
 * Read-only.
 */
import { google } from 'googleapis';
import { appConfig as config } from '../src/modules/00-foundation/index.js';
import { closeDb } from '../src/modules/00-foundation/index.js';

const SPREADSHEETS: Array<{ name: string; id: string; tab: string }> = [
  {
    name: 'Basmalah Travel',
    id: '1z6hCUAvzoTHwcmI9Sg3bN2VmEIhPw6cvCTGZYhBHIwE',
    tab: 'PUSAT - REPORTING',
  },
  {
    name: 'Aqiqah PUSAT',
    id: '1KES1HBKuR7fXgfYV7c5b2tYcsazahcu08gH_Aibdh7c',
    tab: 'PUSAT - REPORTING',
  },
];

function colLetterFor(zeroIndex: number): string {
  let n = zeroIndex;
  let s = '';
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

function makeAuth() {
  return new google.auth.GoogleAuth({
    keyFile: config.google.credentialsPath,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
}

async function main(): Promise<number> {
  const sheets = google.sheets({ version: 'v4', auth: makeAuth() });

  for (const target of SPREADSHEETS) {
    console.log(`\n═══════════════════════════════════════════════════════`);
    console.log(`📋 ${target.name} → "${target.tab}"`);
    console.log(`═══════════════════════════════════════════════════════`);

    const range = `'${target.tab}'!A1:BI8`;
    const [valRes, formulaRes] = await Promise.all([
      sheets.spreadsheets.values.get({
        spreadsheetId: target.id,
        range,
        valueRenderOption: 'FORMATTED_VALUE',
      }),
      sheets.spreadsheets.values.get({
        spreadsheetId: target.id,
        range,
        valueRenderOption: 'FORMULA',
      }),
    ]);

    const rows = (valRes.data.values ?? []) as string[][];
    const formulaRows = (formulaRes.data.values ?? []) as string[][];

    if (rows.length === 0) {
      console.log('  (empty)');
      continue;
    }

    // Find header row: first row with ≥3 non-empty cells.
    let headerIdx = 0;
    for (let i = 0; i < rows.length; i += 1) {
      const nonEmpty = (rows[i] ?? []).filter((c) => String(c ?? '').trim()).length;
      if (nonEmpty >= 3) {
        headerIdx = i;
        break;
      }
    }
    const headers = rows[headerIdx] ?? [];
    const subHeaders = rows[headerIdx + 1] ?? [];
    const sampleData = rows[headerIdx + 2] ?? [];
    const sampleData2 = rows[headerIdx + 3] ?? [];

    console.log(`Header row: ${headerIdx + 1}`);
    console.log(`Total cols sampled: ${headers.length}`);

    for (let c = 0; c < Math.max(headers.length, subHeaders.length); c += 1) {
      const col = colLetterFor(c);
      const h = String(headers[c] ?? '').trim();
      const sub = String(subHeaders[c] ?? '').trim();
      const formula = formulaRows[headerIdx + 1]?.[c] ?? formulaRows[headerIdx + 2]?.[c] ?? '';
      const isFormula = typeof formula === 'string' && formula.startsWith('=');

      const sampleA = String(sampleData[c] ?? '').trim();
      const sampleB = String(sampleData2[c] ?? '').trim();
      if (!h && !sub && !sampleA) continue; // skip fully blank columns

      const label = h || sub || '(no header)';
      const formulaTag = isFormula
        ? `   [formula: ${truncate(String(formula), 70)}]`
        : '';
      const samples = [sampleA, sampleB]
        .filter((s) => s !== '')
        .slice(0, 2)
        .join(' / ');
      console.log(
        `  ${col.padStart(2)}: ${truncate(label, 40).padEnd(40)} ${samples ? `e.g. ${truncate(samples, 30)}` : ''}${formulaTag}`,
      );
    }
  }
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
