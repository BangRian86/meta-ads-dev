# Blueprint — 18-audience-builder

## Tujuan
Pembuatan custom audience Meta (engagement IG/FB, lookalike,
multi-source) plus listing audience aktif. Sebelumnya inline di
`11-auto-optimizer/audience-creator.ts`; dipindah jadi modul sendiri
April 2026 untuk break circular dependency 11↔12 (approval-queue
butuh audience builder, optimizer butuh approval-queue).

## File & Fungsi

| File | Fungsi |
|------|--------|
| `schema.ts` | Zod input schemas: `engagementSourceTypeSchema` (instagram/facebook), `createEngagementAudienceInputSchema`, `createLookalikeInputSchema`. Plus types. |
| `audience-creator.ts` | `createEngagementAudience` (single source), `createLookalike` (per-ratio call), `createMultiSourceEngagementAudience` (gabung IG + FB page dari `meta_connections.page_id` / `ig_business_id`), `listMetaAudiences` (read-only). Semua write wrapped `withAudit`. Log ke `meta_request_logs`. |
| `index.ts` | Barrel export. |

## Dependensi

- **Modul lain:** `00-foundation` (db, logger, appConfig, withAudit,
  requireActiveConnection, markInvalid, mapMetaError, mapHttpFailure,
  TokenInvalidError, MappedMetaError type).
- **Tabel database:** `meta_connections` (read), `meta_request_logs`
  (write), `operation_audits` (write via withAudit).
- **External API:** Meta Graph API
  `/act_{adAccountId}/customaudiences` (POST + GET).

## Cara Penggunaan

```typescript
import {
  createMultiSourceEngagementAudience,
  createLookalike,
  listMetaAudiences,
} from '../18-audience-builder/index.js';

// Multi-source engagement (IG + FB page combined)
const aud = await createMultiSourceEngagementAudience({
  connectionId,
  retentionDays: 60,
  name: 'Engager 60d',
  actorId: 'tg:rian',
});

// Lookalike per ratio (1%, 2%, 3%)
const lal = await createLookalike({
  connectionId,
  name: 'Engager 60d',
  originAudienceId: aud.id,
  ratios: [0.01, 0.02, 0.03],
  country: 'ID',
});

// List audiences (untuk dashboard /audiences atau Telegram)
const list = await listMetaAudiences(connectionId);
```

## Catatan Penting

- **Pisah dari 11-auto-optimizer**: Audience creation bukan optimizer
  decision — itu utility yang dipanggil oleh banyak caller (Telegram
  `/create_audience`, approval-queue executor, dashboard `/audiences`).
  Pisahkan supaya optimizer tidak jadi "god module".
- **Per-ratio call untuk lookalike**: Meta support multi-ratio dalam
  satu `lookalike_spec`, tapi modul sengaja per-ratio supaya tiap
  audience punya `operation_audits` row sendiri (mudah audit per-LAL).
- **Multi-source baca dari connection**: `pageId` + `igBusinessId` dari
  `meta_connections` row. Override hanya untuk one-off.
- **Token invalid → markInvalid + TokenInvalidError**: konsisten dengan
  pattern modul Meta-write lain.
- **List read-only, tidak via withAudit** — read tidak butuh audit row
  per-call, tapi tetap log ke `meta_request_logs`.
