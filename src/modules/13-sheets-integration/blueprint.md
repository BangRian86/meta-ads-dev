# Blueprint — 13-sheets-integration

## Tujuan
Read-only integrasi Google Sheets untuk dua spreadsheet bisnis
(Basmalah Travel + Aqiqah Express), expose daily report agregat
(meta_leads, total_chat, total_closing, total_keberangkatan/ekor,
revenue) per tab, dan helper closing-revenue per ad account.

## File & Fungsi

| File | Fungsi |
|------|--------|
| `client.ts` | `getSheetsClient()` — lazy singleton `googleapis.sheets`, auth via `GOOGLE_APPLICATION_CREDENTIALS` (service account, scope `spreadsheets.readonly`). |
| `reader.ts` | `readSheetData(spreadsheetId, tab)` — parse layout: header row 1-3, data dari row 4. Kolom: rawDate, dateIso (parse "2 Apr" → YYYY-MM-DD), metaLeads, totalChat, totalClosing, totalKeberangkatan (col N), revenue (col O). `parseShortDate` helper bahasa Indonesia (jan, feb, mar, mei, agu, okt, des). |
| `report.ts` | `SHEET_SOURCES` constant (5 tab: 1 Basmalah Travel + 4 Aqiqah cabang Pusat/Jatim/Jabar/Jogja). `buildDailyReport / getReportForDate / getYesterdayReport / isoYesterday / normalizeDateArg`. Type `DailyReport`, `SectionData`, `SectionError`. |
| `closing-source.ts` | `getClosingRevenueForRange(source, since, until)`, `getClosingRevenueForAccount(connection, range)` — aggregat closing + revenue per range. `matchSheetSourceForAccount(connection)` map ad account ke `SheetSource`. `unitForKind` ("jamaah" untuk basmalah, "ekor" untuk aqiqah). |
| `index.ts` | Barrel export. |

## Dependensi

- **Modul lain:** `config/env` (google.credentialsPath), `lib/logger`.
- **Tabel database:** none (read-only ke Google Sheets).
- **External API:** Google Sheets API v4 (read-only scope).

## Cara Penggunaan

```typescript
import {
  buildDailyReport,
  getYesterdayReport,
  getClosingRevenueForRange,
  SHEET_SOURCES,
} from '../13-sheets-integration/index.js';

// Daily report untuk semua 5 tab
const report = await getYesterdayReport();
console.log(report.sections); // per-business breakdown

// Closing untuk 1 source dalam range
const agg = await getClosingRevenueForRange(
  SHEET_SOURCES[0],
  '2026-04-01',
  '2026-04-26',
);
console.log(agg.totalClosing, agg.totalRevenueIdr);
```

## Catatan Penting

- **Hardcoded mapping** — `SHEET_SOURCES` adalah konstanta dengan
  spreadsheet ID + tab name + business kind (basmalah/aqiqah). Kalau
  sheet baru, harus tambah ke array.
- **Layout sheet asumsi:** header row 1-3, data start row 4. Format
  date kolom A "2 Apr" (no year) → parser asumsi tahun current.
- **Bahasa Indonesia month abbrev** — `parseShortDate` cover jan, feb,
  mar, apr, mei (juga "may"), jun, jul, agu/agt (juga "aug"), sep,
  okt (juga "oct"), nov, des (juga "dec").
- **Read-only** — tidak ada write back ke Sheets. Kalau perlu append,
  mintalah scope baru + helper terpisah.
- **Per-section error tolerance** — kalau 1 tab error (sheet rename,
  permission), section yang lain tetap di-render dengan `SectionError`
  marker.
- **Kolom N dual-meaning** — basmalah = "Total Jamaah", aqiqah =
  "Jumlah Ekor". `unitForKind` translate ke label yang tepat.
- **Service account file path** dari `GOOGLE_APPLICATION_CREDENTIALS`
  env. File harus di-share ke email service account dari sisi sheet.
