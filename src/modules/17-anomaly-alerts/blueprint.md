# Blueprint — 17-anomaly-alerts

## Tujuan
Deteksi 4 jenis anomali realtime per connection (spend drop, spend
spike, no impressions, CPR spike) dan kirim notifikasi ke group
Telegram, dengan dedupe 6 jam supaya tidak spam alert yang sama.

## File & Fungsi

| File | Fungsi |
|------|--------|
| `detector.ts` | `detectAndNotifyAnomalies(connectionId)` — entry point. Loop active campaign, panggil `02-ads-analysis/analyze` (today + baseline yesterday), bandingkan. Threshold: spend drop < 50%, spend spike > 200%, no_impressions ≥ 2 jam, CPR spike > 200%. `AnomalyAlert` { kind, key, message }. Catch-all error → log saja (tidak abort caller). |
| `dedupe.ts` | `isOnCooldown(key)` cek `alert_dedupe.last_sent_at` < 6 jam. `markSent(key)` upsert `last_sent_at=now()`. Cooldown window konstan 6 × 60 × 60 × 1000 ms. |
| `index.ts` | Barrel export `detectAndNotifyAnomalies`, `AnomalyAlert`, `AnomalyKind`. |

## Dependensi

- **Modul lain:** `00-foundation` (db),
  `02-ads-analysis` (analyze — read insights), `10-telegram-bot/notifications`
  (notifyOwner — group-only setelah re-wiring), `lib/logger`.
- **Tabel database:** `meta_connections` (read), `meta_object_snapshots`
  (read), `alert_dedupe` (CRUD).
- **External API:** Meta Graph API (lewat `02-ads-analysis`).

## Cara Penggunaan

```typescript
import { detectAndNotifyAnomalies } from '../17-anomaly-alerts/index.js';

// Dipanggil dari runner optimizer di akhir cycle:
await detectAndNotifyAnomalies(connectionId);
// Alert otomatis push ke group via notifyOwner kalau ada anomali baru.
// Yang sudah pernah fire 6 jam terakhir akan di-skip.
```

## Catatan Penting

- **4 anomaly kind** dengan threshold hard-coded:
  - `spend_drop` — today < 50% baseline yesterday.
  - `spend_spike` — today > 200% baseline.
  - `no_impressions` — 0 impressions ≥ 2 jam.
  - `cpr_spike` — CPR today > 200% CPR yesterday.
- **Dedupe 6 jam** lewat `alert_dedupe.alert_key` — key biasanya
  `kind:campaignId` supaya distinct per campaign per kind.
- **Push ke group** (bukan DM owner) — design choice supaya tim sales
  bisa langsung respond.
- **Error tolerant** — `try/catch` di luar; failure di sini tidak
  abort optimizer pass yang call ini.
- **Tidak ada self-healing action** — hanya notify. Action di
  optimizer atau manual via Telegram.
- **Sudah pakai `00-foundation`** untuk db.
- **Kalau dedupe row tidak ada** → return false (tidak on cooldown,
  alert akan fire). Upsert via `onConflictDoUpdate`.
