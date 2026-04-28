# Blueprint — 16-ad-publisher

## Tujuan
Materialize copy variant yang sudah approved jadi ad baru di Meta:
clone source ad, swap text di `object_story_spec`, create creative
baru + ad baru (PAUSED), via approval-queue.

## File & Fungsi

| File | Fungsi |
|------|--------|
| `meta-creative.ts` | `fetchSourceAd(connection, adId)` — return `SourceAdSnapshot` (adId, adsetId, creativeId, objectStorySpec, hasObjectStoryId). `createCreativeAtMeta` (POST `/act_{id}/adcreatives`) + `createAdFromCreative` (POST `/act_{id}/ads` dengan status=PAUSED). |
| `enqueue.ts` | `enqueuePublishAd({ variantId, requestedBy })` — validasi variant `status='approved'`, resolve source ad dari campaign, enqueue pending action `kind='publish_ad'`. Return ok atau reason kalau gagal validasi. |
| `executor.ts` | `executePublishAd(payload)` — dipanggil oleh approval-queue dispatcher: re-fetch variant + source ad, build new `object_story_spec` dengan swapped text, create creative baru, create ad baru, notify ke group. `withAudit` wrapper. |
| `index.ts` | Barrel export `enqueuePublishAd / executePublishAd`. |

## Dependensi

- **Modul lain:** `00-foundation` (recordAudit/withAudit, auth,
  error-mapper, appConfig, notifyOwner — `notifyOwner` dipindah dari
  `10-telegram-bot/notifications` April 2026), `12-approval-queue`
  (enqueue, action types).
- **Tabel database:** `copy_variants` (read — variant yang approved),
  `meta_object_snapshots` (read — source ad), `meta_connections`
  (read), `meta_request_logs` (write), `pending_actions` (write —
  via approval-queue), `operation_audits` (write).
- **External API:** Meta Graph API `/{ad_id}` (read), `/act_{id}/adcreatives`
  (POST), `/act_{id}/ads` (POST).

## Cara Penggunaan

```typescript
import { enqueuePublishAd } from '../16-ad-publisher/index.js';

// Telegram /publish <variantId>
const result = await enqueuePublishAd({
  variantId: 'uuid',
  requestedBy: 'tg:rian',
});
if (!result.ok) {
  await ctx.reply(`Tidak bisa publish: ${result.reason}`);
} else {
  await notifyOwner(formatConfirmation(result.pending));
}

// Eksekusi terjadi otomatis lewat approval-queue dispatcher saat
// approver balas `/yes <shortId>`.
```

## Catatan Penting

- **Copy text swap, bukan ulang dari nol** — modul ambil source ad's
  `object_story_spec`, replace primary/headline/description/CTA,
  POST sebagai creative baru. Tidak rebuild target / placement /
  budget.
- **Selalu PAUSED saat create** — sama seperti `01-manage-campaigns`,
  ad baru tidak langsung live.
- **`hasObjectStoryId` reject** — kalau source ad reference existing
  post (page post boost) bukan object_story_spec inline, modul tidak
  bisa swap text. Variant harus pakai source ad yang lain.
- **Variant harus tetap `approved` saat eksekusi** — kalau ke-reject
  di antara enqueue dan execute, executor return ok=false.
- **Ad baru di adset yang sama** dengan source ad — assume copy fix
  untuk bid/audience yang sama, hanya text yang di-test.
- **Audit lengkap** — `withAudit` wrap creative + ad creation, jejak
  newAdId + newCreativeId di response.
