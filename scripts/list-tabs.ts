import { google } from 'googleapis';
import { config } from '../src/config/env.js';
import { closeDb } from '../src/db/index.js';

async function main() {
  const auth = new google.auth.GoogleAuth({
    keyFile: config.google.credentialsPath,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const s = google.sheets({ version: 'v4', auth });
  for (const id of [
    '1KES1HBKuR7fXgfYV7c5b2tYcsazahcu08gH_Aibdh7c',
    '1z6hCUAvzoTHwcmI9Sg3bN2VmEIhPw6cvCTGZYhBHIwE',
  ]) {
    const meta = await s.spreadsheets.get({
      spreadsheetId: id,
      fields: 'properties(title),sheets(properties(title))',
    });
    console.log(`=== ${meta.data.properties?.title} (${id.slice(0, 12)}…) ===`);
    for (const sh of meta.data.sheets ?? []) {
      const t = sh.properties?.title ?? '';
      console.log(`  • ${JSON.stringify(t)} (len=${t.length})`);
    }
  }
}

await main();
await closeDb();
