import { closeDb } from '../src/modules/00-foundation/index.js';
import { loadAllAlertConfigs } from '../src/modules/30-sheets-reader/index.js';
import { google } from 'googleapis';
import { appConfig as config } from '../src/modules/00-foundation/index.js';

async function main() {
  const r = await loadAllAlertConfigs();
  console.log('--- loadAllAlertConfigs ---');
  console.log('rows:', r.rows.length);
  for (const row of r.rows) console.log('  ', row);
  console.log('missingTab:', r.missingTab);

  // Also dump raw tab content for both businesses to see what's there.
  console.log('\n--- raw ALERT_CONFIG_Aqiqah A1:F30 ---');
  await dumpRange(
    '1KES1HBKuR7fXgfYV7c5b2tYcsazahcu08gH_Aibdh7c',
    "'ALERT_CONFIG_Aqiqah'!A1:F30",
  );
  console.log('\n--- raw ALERT_CONFIG_Basmalah A1:F30 ---');
  await dumpRange(
    '1z6hCUAvzoTHwcmI9Sg3bN2VmEIhPw6cvCTGZYhBHIwE',
    "'ALERT_CONFIG_Basmalah'!A1:F30",
  );
}

async function dumpRange(spreadsheetId: string, range: string) {
  const auth = new google.auth.GoogleAuth({
    keyFile: config.google.credentialsPath,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const rows = res.data.values ?? [];
  rows.forEach((row, i) => {
    console.log(`row ${i + 1}:`, JSON.stringify(row));
  });
}

await main();
await closeDb();
