# Blueprint — 15-closing-tracker

## Tujuan
Track closing (transaksi nyata) dan revenue per ad account untuk
hitung ROAS yang akurat — gabung data Meta spend dengan closing dari
Google Sheets (atau manual entry kalau Sheets tidak tersedia).

## File & Fungsi

| File | Fungsi |
|------|--------|
| `service.ts` | `recordClosing(input)` — manual entry ke `closing_records` (revenue dalam IDR rupiah, dikonversi ke minor di sini). `buildRoasReport / buildRoasReportForRange` (semua akun), `buildCampaignRoasForRange` (per campaign). `resolveConnectionByAlias` (find connection by name/alias). `RoasAccountRow`, `CampaignRoasRow`, `RoasReport` types. `ClosingSource` ('sheets' \| 'manual' \| 'none'). |
| `formatter.ts` | `formatRoasReport(r)` — text report Indonesia: header range, per-akun block (Ad Spend / Revenue / Closing / ROAS), TOTAL footer. Source tag `(manual)` / `(no data)` / kosong (sheets). |
| `index.ts` | Barrel export. |

## Dependensi

- **Modul lain:** `00-foundation` (db, config, logger),
  `02-ads-analysis` (analyze — untuk spend), `13-sheets-integration`
  (getClosingRevenueForAccount, unitForKind — primary closing source).
- **Tabel database:** `closing_records` (CRUD — manual fallback),
  `meta_connections` (read), `meta_object_snapshots` (read).
- **External API:** Google Sheets via `13-sheets-integration`. Meta
  Graph API via `02-ads-analysis`.

## Cara Penggunaan

```typescript
import {
  recordClosing,
  buildRoasReport,
  formatRoasReport,
} from '../15-closing-tracker/index.js';

// Manual entry (saat Sheets belum di-update)
await recordClosing({
  connectionId,
  closingDate: '2026-04-26',
  quantity: 5,
  revenueIdr: 75000000, // Rp 75 juta
  notes: 'Manual dari Telegram',
  createdBy: 'tg:rian',
});

// Report ROAS kemarin (semua akun)
const report = await buildRoasReport({ /* default = yesterday */ });
const text = formatRoasReport(report);
await notifyOwner(text);
```

## Catatan Penting

- **Closing source priority:** `sheets` → `manual` → `none`. Kalau
  Sheets ada data untuk range tersebut, sheets dipakai. Kalau tidak,
  fallback ke `closing_records` manual entry. Kalau dua-duanya kosong,
  `closingSource='none'` dan revenue=0.
- **Revenue dari Sheets dipakai unit `keberangkatan/ekor`** — basmalah
  pakai `total_jamaah`, aqiqah pakai `total_ekor`. Modul tahu via
  `unitForKind`.
- **ROAS = revenue / spend** — kalau spend = 0, return Infinity →
  formatter render "—".
- **Per-campaign ROAS** (`buildCampaignRoasForRange`) lebih kasar —
  attribution ke campaign tertentu tidak persis (Sheets data per-akun,
  bukan per-campaign).
- **Range default = yesterday** — untuk daily summary cron.
- **Format report Indonesian** — `Rp 1.234.567`, `2.5x`, label "Ad
  Spend / Revenue / Closing / ROAS".
- **Sudah migrate ke `00-foundation` (Phase 5 pilot)** — import db /
  config / logger via foundation re-exports.
