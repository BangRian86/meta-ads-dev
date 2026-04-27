# Blueprint — 04-budget-control

## Tujuan
Naikkan / turunkan budget campaign (CBO) atau ad set (ABO) dengan
deteksi otomatis di mana budget "berada" (Campaign Budget Optimization
atau Ad-Set Budget Optimization), validasi cap +20% per operasi, dan
batas minimum.

## File & Fungsi

| File | Fungsi |
|------|--------|
| `schema.ts` | `budgetTargetSchema` (campaign\|adset), `BudgetSnapshot` type, `BudgetKind` (daily\|lifetime), `BudgetLevel` (cbo\|abo), input schemas increase/decrease. |
| `meta-budget.ts` | `readBudget` + `writeBudget` — Graph API GET/POST untuk daily_budget / lifetime_budget. Field map per object type. |
| `budget-detector.ts` | `detectBudgetOwner(target)` — kalau diminta ubah ad set tapi sebenarnya CBO, throw `BudgetTargetMismatchError`. `findFirstAdsetWithBudget` untuk ABO. Throws `NoBudgetConfiguredError` kalau zero baseline. |
| `budget-rules.ts` | `MAX_INCREASE_PCT=20`, `DEFAULT_MIN_DAILY_BUDGET_MINOR=100`, error class (`BudgetCapExceededError`, `BudgetBelowMinError`, `BudgetNotIncreaseError`, `BudgetNotDecreaseError`), helper `assertAboveMinimum`, `assertWithinIncreaseCap`, `deriveTargetAmount`, `pctChange`. |
| `service.ts` | Public facade `increaseBudget / decreaseBudget`. Pipeline: detect owner → load current → derive target → assert rules → write → audit. |
| `index.ts` | Barrel export. |

## Dependensi

- **Modul lain:** `lib/audit-logger`, `lib/auth-manager`, `lib/error-mapper`, `config/env`.
- **Tabel database:** `meta_object_snapshots` (read — untuk locate adset child kalau ABO),
  `meta_request_logs` (write), `operation_audits` (write), `meta_connections` (read).
- **External API:** Meta Graph API GET/POST `/{campaign_id|adset_id}` field `daily_budget`, `lifetime_budget`.

## Cara Penggunaan

```typescript
import { increaseBudget, decreaseBudget } from '../04-budget-control/index.js';

// Naik 15% → di-validate ≤ 20%
const r = await increaseBudget({
  connectionId,
  target: { type: 'campaign', id: '123' },
  pctChange: 15,
  actorId: 'tg:rian',
});
console.log(r.previousMinor, '→', r.newMinor);

// Turun 30% — pakai pctChange negative
await decreaseBudget({
  connectionId,
  target: { type: 'adset', id: '456' },
  pctChange: -30,
});
```

## Catatan Penting

- **Cap +20% per operasi** — untuk increase, kalau request > 20% akan
  throw `BudgetCapExceededError`. Filosofi: Meta learning phase butuh
  perubahan bertahap, bukan loncat besar.
- **Auto-detect CBO vs ABO** — caller boleh request "ubah budget adset",
  modul cek apakah budget ada di adset (ABO) atau parent campaign
  (CBO). Kalau mismatch, throw `BudgetTargetMismatchError` dengan
  pointer ke owner sebenarnya.
- **Daily atau lifetime, tergantung yang ada** — `writeBudget` memilih
  field yang non-null di current state.
- **Zero baseline ditolak** — kalau campaign / adset tidak punya budget
  config, throw `NoBudgetConfiguredError` (tidak bisa menghitung % dari 0).
- **Minimum hard floor** — `DEFAULT_MIN_DAILY_BUDGET_MINOR=100` (mis. $1
  cents). Decrease yang akan menembus minimum ditolak.
- **Audit jejak `previousMinor` + `newMinor`** untuk semua operasi.
