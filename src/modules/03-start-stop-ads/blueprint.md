# Blueprint — 03-start-stop-ads

## Tujuan
Pause / unpause campaign / ad set / ad dengan validasi parent chain
(unpause anak yang parent-nya PAUSED akan jadi noop) dan deteksi
blocker delivery (disapproved, pending review, billing issue, dll).

## File & Fungsi

| File | Fungsi |
|------|--------|
| `schema.ts` | `objectRefSchema`, `statusChangeInputSchema`, `META_STATUSES` (ACTIVE, PAUSED, DELETED, ARCHIVED), `MetaEffectiveStatus` type. |
| `meta-objects.ts` | `fetchObject` — read `id, status, effective_status, parent_id` per object type. Log ke `meta_request_logs`. |
| `meta-mutations.ts` | `setObjectStatus(connectionId, ref, 'ACTIVE'\|'PAUSED')` via Graph API POST `/{id}` form. Throws `MetaWriteError`. |
| `parent-chain.ts` | `loadChain` — load target + ad set + campaign secara paralel untuk validasi blocker. |
| `delivery-blockers.ts` | `deriveActivationBlockers` — translate parent chain + effective_status jadi list `Blocker` dengan code (`self_deleted`, `parent_paused`, `disapproved`, dll), level (self/adset/campaign), dan message human-readable. |
| `service.ts` | Public facade `pause / unpause`. Pre-check status (noop kalau sudah di state target), check blocker (untuk unpause), call mutation, wrap di `withAudit`. Outcome: `success / noop / blocked`. |
| `index.ts` | Barrel export. |

## Dependensi

- **Modul lain:** `lib/audit-logger`, `lib/auth-manager`, `lib/error-mapper`, `config/env`.
- **Tabel database:** `meta_request_logs` (write), `operation_audits` (write via withAudit), `meta_connections` (read).
- **External API:** Meta Graph API GET / POST `/{campaign_id|adset_id|ad_id}`.

## Cara Penggunaan

```typescript
import { pause, unpause } from '../03-start-stop-ads/index.js';

// Pause — biasanya selalu sukses
const out = await pause({
  connectionId,
  target: { type: 'ad', id: '123' },
  actorId: 'tg:rian',
});
if (out.outcome === 'noop') console.log('already paused');

// Unpause — bisa ke-block kalau parent paused / ad disapproved
const r = await unpause({ connectionId, target: { type: 'adset', id: '456' } });
if (r.outcome === 'blocked') {
  console.log(r.blockers); // [{ code: 'parent_paused', ... }]
}
```

## Catatan Penting

- **Outcome ada 3 state:**
  - `success` — status berubah di Meta.
  - `noop` — sudah di status target, skip API write.
  - `blocked` — ada `Blocker[]` yang mencegah unpause (cuma muncul di unpause flow).
- **Pause tidak pernah blocked** — selalu boleh pause apapun, bahkan
  yang sudah disapproved.
- **Unpause memvalidasi parent chain:** kalau ad → cek adset + campaign;
  kalau adset → cek campaign. Parent yang PAUSED / DELETED /
  DISAPPROVED akan menghasilkan blocker — caller harus fix parent dulu.
- **`effective_status` dipakai untuk deteksi billing / review issue** —
  status `ACTIVE` di field `status` belum berarti delivery aktif.
- **Setiap perubahan tercatat di `operation_audits`** dengan
  `previousStatus` + `newStatus` sebagai bukti audit.
