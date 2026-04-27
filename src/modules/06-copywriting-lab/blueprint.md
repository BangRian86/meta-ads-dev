# Blueprint — 06-copywriting-lab

## Tujuan
Generate copy ad (primary text, headline, description, CTA) — baik via
heuristic template lokal maupun via Claude API — review skor multi-dimensi,
dan kelola lifecycle variant: draft → approved/rejected.

## File & Fungsi

| File | Fungsi |
|------|--------|
| `schema.ts` | Zod schemas + types: `BriefFields`, `VariantFields`, `CopyVariantStatus` (draft/approved/rejected), `CopyVariantStrategy` (heuristic/manual/reviewed_existing), `DimensionScore`, `ReviewNotes`, semua input/review schemas. |
| `brief-store.ts` | CRUD `copy_briefs`: `insertBrief / patchBrief / deleteBrief / getBrief / parseBrief`. |
| `variant-store.ts` | CRUD `copy_variants`: `insertVariant / applyReview / setVariantStatus / getVariant / listVariantsForBrief`. |
| `generator.ts` | `generateVariants` — angle templates lokal (benefit-led, urgency, social proof, dll), CTA dictionary by `targetAction`. Tidak butuh API. |
| `ai-generator.ts` | `generateAiVariantsForBadAd` — call Claude (Anthropic SDK) dengan structured output, log token usage ke `ai_usage_logs` + cost lewat `10-telegram-bot/ai-pricing`. |
| `reviewer.ts` | `reviewVariant` — score per dimension (clarity, emotion, urgency, brand fit, CTA), pakai dictionary kata emotional/urgency, return `DimensionScore` + notes. |
| `service.ts` | Public facade: `createBrief / updateBrief / removeBrief / generate / createVariant / review / reviewExternalCopy / setStatus / listForBrief`. Wrap `recordAudit`. |
| `index.ts` | Barrel export. |

## Dependensi

- **Modul lain:** `lib/audit-logger`, `config/env`, `lib/logger`,
  `10-telegram-bot/ai-pricing` (computeCostUsd), `14-meta-progress`
  (Brand type re-use).
- **Tabel database:** `copy_briefs` (CRUD), `copy_variants` (CRUD),
  `ai_usage_logs` (write — token + cost), `operation_audits` (write).
- **External API:** Anthropic Claude API (untuk `ai-generator`).

## Cara Penggunaan

```typescript
import {
  createBrief,
  generate,
  review,
  setStatus,
} from '../06-copywriting-lab/index.js';

const brief = await createBrief({
  connectionId,
  brief: {
    title: 'Promo Umroh Maret',
    product: 'Paket Umroh Plus',
    keyBenefits: ['9 hari', 'pesawat langsung'],
    forbiddenWords: ['murah', 'cheap'],
    targetAction: 'book',
  },
});

// Heuristic generate (lokal, instant)
const out = await generate({
  briefId: brief.id,
  count: 3,
  strategy: 'heuristic',
});

// Review existing copy
const r = await review({ variantId: out.variants[0].id });
// Approve / reject
await setStatus({ variantId: out.variants[0].id, status: 'approved' });
```

## Catatan Penting

- **Dua strategi generate:**
  - `heuristic` — lokal, deterministic, gratis. Pakai angle templates +
    CTA dictionary.
  - AI (`ai-generator`) — pakai Claude, structured output via
    `zodOutputFormat`. Hanya dipakai untuk "bad ad rescue" (lihat
    `generateAiVariantsForBadAd`). Cost di-track ke `ai_usage_logs`.
- **Forbidden words enforcement** — `reviewer` cek kata yang
  di-blacklist di brief, turunkan score brand-fit.
- **Reviewer bukan AI** — pakai dictionary + heuristik. Hasil `DimensionScore`
  per dimensi (0-100), bukan satu skor agregat saja.
- **Variant tree** — `parentId` di `copy_variants` memungkinkan track
  iterasi: draft → revisi → revisi.
- **Review external copy** — `reviewExternalCopy` untuk cek copy yang
  tidak datang dari brief internal (mis. copy yang sudah live di Meta).
- **`zodOutputFormat` pakai `zod/v4`** — bukan import default `zod`,
  karena helper SDK menggunakan z.toJSONSchema dari zod v4.
