# Blueprint — 07-rules-management

## Tujuan
Mengelola Meta Ads Automated Rules end-to-end: draft → publish ke
Meta, update, enable/disable, delete, refresh snapshot, plus formatter
human-readable untuk Telegram / dashboard.

## File & Fungsi

| File | Fungsi |
|------|--------|
| `schema.ts` | Zod schemas: `MetaRuleStatus` (ENABLED/DISABLED/DELETED), `RuleDraftState` (draft/published/discarded), `EvaluationSpec`, `ExecutionSpec`, `ScheduleSpec`, `RuleFilter` (operator: GREATER_THAN, LESS_THAN, EQUAL, IN_RANGE, dll). Plus 8 input schemas (createDraft, publish, update, status change, delete, refresh, dst). |
| `meta-rules.ts` | HTTP wrapper Graph API: `createRuleAtMeta / updateRuleAtMeta / setRuleStatusAtMeta / deleteRuleAtMeta / fetchRuleFromMeta`. Endpoint `/act_{id}/adrules_library`. |
| `draft-store.ts` | CRUD `meta_rule_drafts`: `insertDraft / patchDraft / getDraft / markDraftDiscarded / markDraftPublished`. `DraftNotEditableError` kalau coba edit draft yang sudah published. |
| `snapshot-store.ts` | CRUD `meta_rule_snapshots`: `saveRuleSnapshot / saveDeletedRuleSnapshot / findLatestSnapshot / listLatestSnapshots / parseSnapshot`. |
| `formatter.ts` | `formatRule` — translate spec JSON jadi `ReadableRule` (text bahasa manusia: "Pause ad if Spend > $50 AND CTR < 1.0%"). Pakai `FIELD_LABELS` + `OPERATOR_TEXT` dictionary. |
| `service.ts` | Public facade: `createDraft / updateDraft / discardDraft / publishDraft / updateRule / enableRule / disableRule / deleteRule / refreshSnapshot / describeRule / listRules`. |
| `index.ts` | Barrel export. |

## Dependensi

- **Modul lain:** `lib/audit-logger`, `lib/auth-manager`, `lib/error-mapper`, `config/env`, `lib/logger`.
- **Tabel database:** `meta_rule_drafts` (CRUD), `meta_rule_snapshots` (CRUD), `meta_request_logs` (write), `operation_audits` (write), `meta_connections` (read).
- **External API:** Meta Graph API `/act_{adAccountId}/adrules_library`, `/{rule_id}` (GET/POST/DELETE).

## Cara Penggunaan

```typescript
import {
  createDraft,
  publishDraft,
  enableRule,
  disableRule,
  describeRule,
} from '../07-rules-management/index.js';

// Workflow draft → publish
const draft = await createDraft({
  connectionId,
  name: 'Pause low CTR',
  evaluation: { /* ... */ },
  execution: { type: 'PAUSE', ... },
  schedule: { schedule_type: 'DAILY' },
});

const result = await publishDraft({ draftId: draft.id });
// result.ruleId = ID di Meta

// Toggle
await disableRule({ connectionId, ruleId: result.ruleId });

// Render bahasa manusia
const text = await describeRule({ connectionId, ruleId: result.ruleId });
console.log(text); // "Pause ad if Spend > $50 AND CTR < 1.0%"
```

## Catatan Penting

- **Draft → Publish 2-step** — modul tidak push langsung ke Meta dari
  schema input. Caller create draft dulu (validasi + simpan), baru
  panggil `publishDraft`. Ini memungkinkan review draft sebelum live.
- **Draft state machine** — `draft` (mutable) → `published` (immutable,
  ada `meta_rule_id`) atau `discarded`. Edit draft published =
  `DraftNotEditableError`.
- **Snapshot per perubahan** — setiap publish/update/status change/delete
  simpan baris baru di `meta_rule_snapshots` (audit history).
- **Soft-delete tracked** — `saveDeletedRuleSnapshot` mencatat rule
  yang di-delete dengan status `DELETED` di snapshot.
- **`describeRule`** baca snapshot terbaru, pakai `formatter.formatRule` —
  hasil siap untuk Telegram message / web UI.
- **Meta operator dictionary** — `formatter` cover 12 operator
  (IN_RANGE, GREATER_THAN, CONTAIN, dll). Field unknown akan fallback
  ke nama field as-is.
