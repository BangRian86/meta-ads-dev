# Blueprint — 01-manage-campaigns

## Tujuan
Modul yang membungkus seluruh operasi Meta Marketing API untuk membuat,
membaca, men-sinkron, dan menduplikasi objek campaign / ad set / ad —
plus persistensi snapshot ke `meta_object_snapshots`.

## File & Fungsi

| File | Fungsi |
|------|--------|
| `schema.ts` | Zod schemas + types untuk semua input (campaign/adset/ad fields, create, duplicate, sync). |
| `preflight.ts` | `preflightCampaign / preflightAdSet / preflightAd` — validasi Zod + warning (CBO+lifetime conflict, special_ad_categories kosong, dll) sebelum hit Meta. |
| `meta-create.ts` | HTTP wrapper Graph API untuk `createCampaignAtMeta / createAdSetAtMeta / createAdAtMeta / copyObjectAtMeta / deleteObjectAtMeta`. Selalu force `status=PAUSED` saat create. |
| `meta-read.ts` | `fetchObject / listAccountCampaigns / listChildren` — read-only Graph API dengan field map per object type. Throw `MetaApiError`. |
| `snapshot-store.ts` | `saveObjectSnapshot / findLatestSnapshot / listCampaignHierarchySnapshots` — write/read `meta_object_snapshots`. |
| `sync.ts` | `syncCampaignHierarchy` (campaign→adsets→ads), `syncSingleObject`, `syncAccount` (semua campaign di satu ad account). |
| `duplicate.ts` | `duplicateObject` — copy via Meta `copies` endpoint + walk hierarchy + rollback steps kalau gagal di tengah. |
| `service.ts` | Public facade: `createCampaign / createAdSet / createAd / syncCampaign / syncObject`. Wrapping `withAudit` + preflight. Throws `PreflightFailedError`. |
| `index.ts` | Barrel export semua public symbols. |

## Dependensi

- **Modul lain:** `lib/audit-logger` (withAudit), `lib/auth-manager`
  (requireActiveConnection, markInvalid, TokenInvalidError),
  `lib/error-mapper`, `config/env`, `lib/logger`.
- **Tabel database:** `meta_object_snapshots` (write), `meta_request_logs`
  (write — tiap HTTP call), `operation_audits` (via withAudit), `meta_connections` (read).
- **External API:** Meta Graph API
  (`/{campaign|adset|ad}_id`, `/act_{adAccountId}/campaigns|adsets|ads`,
  `/{id}/copies`, `DELETE /{id}`).

## Cara Penggunaan

```typescript
import {
  createCampaign,
  syncCampaignHierarchy,
  duplicateObject,
} from '../01-manage-campaigns/index.js';

// Create (auto-paused, audited)
const res = await createCampaign({
  connectionId: 'uuid',
  campaign: {
    name: 'Promo Q2',
    objective: 'OUTCOME_SALES',
    specialAdCategories: [],
    dailyBudgetMinor: 50000,
  },
  actorId: 'tg:rian',
});

// Sync 1 campaign + semua child
const tree = await syncCampaignHierarchy(connectionId, campaignId);

// Duplicate campaign + child + auto-rollback kalau gagal
const dup = await duplicateObject({
  connectionId,
  type: 'campaign',
  sourceId: '123',
});
```

## Catatan Penting

- **Semua create selalu PAUSED** — design choice agar tidak ada ad
  langsung live tanpa review. Aktivasi via `03-start-stop-ads`.
- **Preflight wajib lulus** — `service.ts` throw `PreflightFailedError`
  sebelum HTTP call. Caller harus handle.
- **Setiap HTTP call dicatat ke `meta_request_logs`** dengan duration,
  status code, payload. Token invalid auto-mark `meta_connections.status='invalid'`
  via `markInvalid()`.
- **Snapshot bukan source of truth realtime** — `meta_object_snapshots`
  hanya di-update saat sync dipanggil. Untuk data fresh harus
  `syncSingleObject()` dulu.
- **Duplicate punya rollback** — kalau hierarchy sync gagal setelah copy,
  modul akan call `deleteObjectAtMeta` untuk membersihkan resource yang
  baru dibuat (best effort, dilog).
