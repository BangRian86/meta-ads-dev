import { google, type sheets_v4 } from 'googleapis';
import { appConfig as config } from '../00-foundation/index.js';

let readClient: sheets_v4.Sheets | null = null;

/**
 * Read-only Sheets client. Module 30-sheets-reader sengaja TIDAK punya
 * write client — service account hanya butuh Viewer access ke Sheet user.
 *
 * Kalau kelak butuh write (e.g. log evaluation history balik ke Sheet),
 * tambah getWriteClient() baru di sini supaya elevated-scope code gampang
 * di-audit. Saat ini scope minimal = `spreadsheets.readonly`.
 */
export function getReadClient(): sheets_v4.Sheets {
  if (readClient) return readClient;
  const auth = new google.auth.GoogleAuth({
    keyFile: config.google.credentialsPath,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  readClient = google.sheets({ version: 'v4', auth });
  return readClient;
}
