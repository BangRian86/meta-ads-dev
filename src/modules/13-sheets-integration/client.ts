import { google, type sheets_v4 } from 'googleapis';
import { appConfig as config } from '../00-foundation/index.js';

let client: sheets_v4.Sheets | null = null;

export function getSheetsClient(): sheets_v4.Sheets {
  if (client) return client;
  const auth = new google.auth.GoogleAuth({
    keyFile: config.google.credentialsPath,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  client = google.sheets({ version: 'v4', auth });
  return client;
}
