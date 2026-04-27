# 00-foundation — PRD

## Goal

Single import path untuk cross-cutting concerns (auth, config, db,
audit, error mapping, HTTP client base, snapshot reads, job dispatch).

## Responsibilities

| Concern | File | Implementation source | Status |
|---|---|---|---|
| Meta token auth | `auth.ts` | Re-export from `src/lib/auth-manager.ts` | ✅ V1 |
| Env config | `config.ts` | Re-export from `src/config/env.ts` | ✅ V1 |
| Drizzle DB | `database.ts` | Re-export from `src/db/index.ts` | ✅ V1 |
| Operation audit | `audit.ts` | Re-export from `src/lib/audit-logger.ts` | ✅ V1 |
| Error mapping | `error-mapper.ts` | Re-export from `src/lib/error-mapper.ts` | ✅ V1 |
| Base HTTP client | `provider-client.ts` | New `ProviderClient` class | ✅ V1 |
| Snapshot reads | `snapshot-repository.ts` | Consolidates pattern from 02/11/14/15/30 | ✅ V1 |
| Job queue | `job-dispatcher.ts` | New pg-boss wrapper | ✅ V1 |

## Non-responsibilities

- **Telegram chat-level auth** (isAllowedChat, isApprover, group-filter)
  → tetap di `10-telegram-bot/auth.ts` + `group-filter.ts`. Itu concern
  Telegraf middleware, bukan provider/system auth.
- **Module-specific business logic** — foundation hanya infra.
- **Migration runner** — tetap via `drizzle-kit migrate` (npm script).

## Migration plan

### Pilot (Phase 5 of initial rollout)

Pilih 2-3 modul yang baru atau aktif diubah:
1. `30-sheets-reader/` — modul baru, belum punya banyak deep imports.
   Migrate untuk demonstrate pattern.
2. `17-anomaly-alerts/` — kecil dan baru.
3. `20-roas-alert/` — sudah deprecated tapi simple, low risk.

### Tier 1 — Active development (next sprint)

- `15-closing-tracker/`, `16-ad-publisher/`, `13-sheets-integration/`

### Tier 2 — Stable, migrate on next significant edit

- `02-ads-analysis/`, `04-budget-control/`, `06-copywriting-lab/`
- `11-auto-optimizer/`, `12-approval-queue/`

### Tier 3 — Avoid touching unless necessary

- `01-manage-campaigns/`, `03-start-stop-ads/`
- `05-kie-image-generator/`, `07-rules-management/`, `09-dashboard-monitoring/`

## Backward compatibility

File lama (`src/lib/*`, `src/config/env.ts`, `src/db/index.ts`) TIDAK
dihapus selama transition window minimum 30 hari setelah pilot. Setelah
semua modul migrate, file lama bisa di-delete dan import path
dipindah ke `00-foundation`.

## pg-boss readiness

pg-boss installed + bootstrap helper exposed, tapi BELUM di-start dari
`src/index.ts`. Alasan: belum ada job yang perlu dispatch. Worker akan
di-start saat ada feature pertama yang pakainya (kemungkinan KIE.ai
async polling).

Lifecycle hook untuk integrasi nanti:
```typescript
// src/index.ts (sketch — belum di-implement)
import { jobDispatcher } from './modules/00-foundation/index.js';
await jobDispatcher.bootstrap();        // start
// register handlers per feature module
process.on('SIGTERM', async () => {
  await jobDispatcher.shutdown();       // graceful
});
```

## Tabel `kie_tasks` ownership

Tabel di-create sebagai bagian foundation rollout, tapi schema +
business logic milik `05-kie-image-generator/` (atau modul KIE.ai
expansion future). Foundation cuma sediakan tabelnya supaya namespace
sudah ada saat module-nya dibangun penuh.

## Tabel `sync_cursors` ownership

Sama: tabel disiapkan, business logic untuk delta sync owner-nya
`01-manage-campaigns/sync.ts`. Sync runner akan upsert cursor setelah
pass sukses; pass berikutnya read cursor untuk filter `updated_since`.

Saat ini `sync.ts` masih full-fetch — cursor support adalah follow-up
task terpisah.

## Acceptance

- [x] Folder `00-foundation/` exists dengan 9 files
- [x] `npx tsc --noEmit` clean
- [x] `kie_tasks` + `sync_cursors` tables di Postgres
- [x] pg-boss installed
- [x] blueprint.md + PRD.md committed
- [ ] Pilot migration selesai (Phase 5)
- [ ] All Tier 1 modules migrated (next sprint)
- [ ] File lama di `src/lib/` di-delete (after 30d transition)
