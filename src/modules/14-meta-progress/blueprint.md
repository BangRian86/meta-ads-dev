# Blueprint — 14-meta-progress

## Tujuan
Generate laporan progress 3x sehari (jam 11/16/21 WIB) berisi
spending + result per campaign, dikelompokkan per bucket
(leads/traffic/awareness), dengan emoji ✅/⚠️ otomatis berdasarkan
benchmark per-brand & per-channel (Basmalah Travel vs Aqiqah).

## File & Fungsi

| File | Fungsi |
|------|--------|
| `benchmarks.ts` | `Brand` (basmalah/aqiqah), `Channel` (leads_wa, leads_lp, traffic_lp, traffic_wa, awareness, sales). `BENCHMARKS` lookup `{cheap, expensive}` per brand+channel. `detectBrand(name)`, `lookupBenchmark(brand, channel, value)`, `statusEmoji` (✅/⚠️/''). Nilai IDR dari playbook operator. |
| `channel.ts` | `classifyCampaign(snapshot)` — translate `objective` (OUTCOME_SALES, OUTCOME_LEADS, dll) + `destination_type` (WHATSAPP/WEBSITE) jadi `{ bucket, channel }`. `SALES_LIKE` + `ENGAGEMENT_LIKE` set untuk legacy objective. |
| `data.ts` | `buildProgressData(connectionId)` — load active campaigns dari `meta_object_snapshots`, panggil `02-ads-analysis/analyze`, hitung spend/results/cpr/cpc/cpm/age, emoji status. Return `ProgressReport`. |
| `report.ts` | `buildProgressBubbles(report)` — render text laporan: header tanggal Indonesian, per-account section, per-bucket subsection, per-campaign baris dengan emoji + IDR formatted. `wibHourLabel` ("11:00 WIB"). |
| `index.ts` | Barrel export. |

## Dependensi

- **Modul lain:** `02-ads-analysis` (analyze).
- **Tabel database:** `meta_connections` (read), `meta_object_snapshots` (read).
- **External API:** Meta Graph API (lewat `02-ads-analysis`).

## Cara Penggunaan

```typescript
import {
  buildProgressData,
  buildProgressBubbles,
  detectBrand,
  classifyCampaign,
} from '../14-meta-progress/index.js';

// Cron entry (scripts/send-meta-progress.ts):
const report = await buildProgressData(connectionId);
const bubbles = buildProgressBubbles(report);
for (const b of bubbles) await notifyOwner(b);

// Direct re-use (mis. dari Telegram /progress)
const brand = detectBrand('Aqiqah Pusat'); // 'aqiqah'
const ch = classifyCampaign(snapshot);     // { bucket: 'leads', channel: 'leads_wa' }
```

## Catatan Penting

- **3x sehari driver di cron** — `/etc/cron.d/maa-meta-progress` →
  04/09/14 UTC = 11/16/21 WIB. `--utc-hour` arg lock label header
  supaya tidak drift kalau cron telat.
- **Brand detection by name pattern** — `detectBrand` look at
  account/campaign name (case-insensitive contain "aqiqah" /
  "basmalah" / "umroh").
- **Channel benchmark different per brand** — basmalah punya threshold
  CPR yang lebih tinggi (high-value tiket umroh) vs aqiqah CPR rendah
  (sales product). Hardcoded di `BENCHMARKS`.
- **`statusEmoji` 3 outcome** — di bawah cheap = ✅, di atas expensive
  = ⚠️, di antara = '' (no emoji).
- **`destination_type` field** dipakai untuk bedakan
  traffic-WA vs traffic-LP — modul `01-manage-campaigns/meta-read`
  sudah include field ini.
- **Bucket grouping di report** — leads di paling atas (paling
  important), traffic di tengah, awareness di paling bawah.
- **Bahasa Indonesia month** — Jan/Feb/Mar/Apr/Mei/.../Des untuk
  format tanggal di header bubble.
