# Blueprint — 20-roas-alert

## Tujuan
**DEPRECATED 2026-04-26.** Modul deteksi ROAS rendah per campaign
dengan threshold per-business × per-stage-funnel. Diganti
`30-sheets-reader` (semua data dari Sheets, tanpa proportional
attribution).

## File & Fungsi

| File | Fungsi |
|------|--------|
| `threshold-config.ts` | `THRESHOLDS` constant: per-`Business` (basmalah/aqiqah) × per-`CampaignType` (BOFU/MOFU/TOFU/SALES/DEFAULT). Tiap row punya `roas_critical` + `roas_warning`. `MIN_SPEND_IDR` (skip campaign yang spend di bawah ini). `getThreshold(business, type)`. |
| `detect-campaign-type.ts` | `detectCampaignType(name)` — case-insensitive substring match: BOFU/RETARGET/RT (whole-word) → BOFU; MOFU/LOOKALIKE/LLA → MOFU; TOFU/INTEREST/COLD → TOFU; SALES/CONVERSION/CLOSING → SALES; lainnya → DEFAULT. |
| `alert-engine.ts` | `evaluateAlerts(connectionId, window)` — ambil per-campaign ROAS via `15-closing-tracker/buildCampaignRoasForRange`, klasifikasi via `detectCampaignType`, bandingkan dengan threshold → `CampaignAlert` { severity: critical/warning/ok }. `AlertWindow` (daily/weekly/monthly). |
| `formatter.ts` | `formatEvaluationResult / formatMultipleResults` — render text bahasa Indonesia dengan template pool (formal-tegas / santai / netral profesional) untuk variasi tone. Window label "hari ini / 7 hari / 30 hari". |
| `index.ts` | Barrel export + deprecation notice. |

## Dependensi

- **Modul lain:** `02-ads-analysis` (DateRange type),
  `13-sheets-integration` (BusinessKind type),
  `15-closing-tracker` (buildCampaignRoasForRange).
- **Tabel database:** read-only (lewat 15-closing-tracker).
- **External API:** none langsung; via 15-closing-tracker.

## Cara Penggunaan

```typescript
// DEPRECATED — jangan dipakai untuk feature baru.
// Module ini masih di-export untuk Telegram /alerts deprecated handler.
import {
  evaluateAlerts,
  formatEvaluationResult,
} from '../20-roas-alert/index.js';

const result = await evaluateAlerts(connectionId, 'daily');
console.log(formatEvaluationResult(result));
```

## Catatan Penting

- **DEPRECATED** — cron lama `/etc/cron.d/maa-roas-alerts` di-disable
  2026-04-26. Pengganti: `30-sheets-reader` + `maa-sheets-alerts` cron
  yang baca 100% dari Google Sheets (tanpa proportional attribution
  spend × revenue).
- **Threshold per-business beda jauh** — Basmalah Travel break-even
  ROAS ≈ 18.6x (AOV Rp 27.9jt, profit/jamaah Rp 1.5jt) → threshold
  tinggi. Aqiqah AOV rendah, threshold lebih kecil.
- **Funnel detection by name keyword** — designer / media buyer wajib
  pakai naming convention (BOFU/MOFU/TOFU di nama campaign).
- **`/\bRT\b/` whole-word** untuk RT → BOFU, supaya "TARGET",
  "PURCHASE", "DEPARTURE" yang punya substring "rt" tidak salah match.
- **`MIN_SPEND_IDR` floor** — campaign dengan spend di bawah threshold
  ini di-skip (data terlalu sedikit untuk reliable signal).
- **Source code masih di-export** untuk transition window
  (`/alerts` deprecated handler di Telegram). Wrapper script
  `scripts/send-roas-alerts.ts` dipertahankan untuk rollback.
