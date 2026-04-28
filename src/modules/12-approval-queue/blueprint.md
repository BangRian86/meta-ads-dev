# Blueprint — 12-approval-queue

## Tujuan
Generic queue untuk action yang butuh konfirmasi human sebelum dieksekusi
(pause / resume / budget change / audience create / copy approve /
publish ad / auto_pause / auto_scale). Tiap entry punya TTL,
`shortId`, formatted message, dan dispatcher executor.

## File & Fungsi

| File | Fungsi |
|------|--------|
| `schema.ts` | `ActionKind` (9 kind: pause, resume, budget, audience_engagement, audience_lookalike, copy_approve, auto_pause, auto_scale, publish_ad), payload types per kind, `ActionSummary`, `EnqueueInput`. |
| `store.ts` | CRUD `pending_actions`: `enqueue(input)` (TTL default 24h), `listLivePending`, `findByShortId`, `findOnlyLivePending`, `markApproved / Rejected / Executed / Failed`. `shortId(row)` derive 6-char public ID. |
| `formatter.ts` | `formatConfirmation(p)` — emoji + 5 line summary + "Ketik 'ya'/'tidak'", `formatPendingList(items)` (cap 10), `formatMultiPendingNudge` (reminder). |
| `executor.ts` | `executePending(p, opts)` — dispatcher per `actionKind`: pause → `03-start-stop-ads`, budget → `04-budget-control`, audience → `18-audience-builder`, copy_approve → `06-copywriting-lab/copy-fix-store.approveOption`, publish_ad → `16-ad-publisher`. Token invalid handled, mark Failed dengan detail. |
| `index.ts` | Barrel export. |

## Dependensi

- **Modul lain:** `00-foundation` (logger, TokenInvalidError),
  `03-start-stop-ads`, `04-budget-control`,
  `06-copywriting-lab` (copy-fix-store.approveOption — pindah dari
  10-telegram-bot April 2026), `18-audience-builder` (pindah dari
  11-auto-optimizer/audience-creator April 2026), `16-ad-publisher`.
- **Tabel database:** `pending_actions` (CRUD).
- **External API:** none langsung; via modul yang dispatch.

## Cara Penggunaan

```typescript
import {
  enqueue,
  formatConfirmation,
  executePending,
  findByShortId,
} from '../12-approval-queue/index.js';

// Enqueue dari optimizer / Telegram command
const p = await enqueue({
  connectionId,
  actionKind: 'budget',
  payload: { campaignId: '123', pctChange: 15 },
  summary: {
    actionLabel: 'Naikkan budget +15%',
    targetLabel: 'Campaign Promo Q2',
    detail: 'Dari Rp 50k → Rp 57.5k',
    reason: 'CTR 3.2%, ROAS 4.1',
    accountName: 'Aqiqah Pusat',
  },
  requestedBy: 'optimizer:auto',
});
await notifyOwner(formatConfirmation(p));

// Approval flow di Telegram /yes <shortId>
const target = await findByShortId(shortId);
const result = await executePending(target);
```

## Catatan Penting

- **TTL default 24 jam** — kalau approver tidak balas, action expired
  dan tidak akan dieksekusi.
- **`shortId` 6 char** — derived dari UUID `pending_actions.id`,
  dipakai di pesan Telegram supaya gampang di-reply.
- **State machine:** pending → approved → executed | failed,
  atau pending → rejected, atau pending → expired.
- **Dispatcher per kind di `executor.ts`** — switch case di satu
  tempat. Kind baru perlu update 4 spot: schema, payload, dispatcher,
  caller.
- **Token invalid** mark Failed dengan detail; tidak retry.
- **Message format konsisten** — semua confirmation pakai 5 baris
  fixed (Aksi / Target / Detail / Alasan / Akun) supaya gampang
  di-scan di group.
- **Multi-pending nudge** untuk kasus banyak action numpuk — formatter
  `formatMultiPendingNudge` ringkas.
