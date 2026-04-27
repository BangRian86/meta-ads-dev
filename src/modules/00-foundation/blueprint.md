# 00-foundation — Architecture Blueprint

> Cross-cutting infrastructure layer untuk modular monolith
> `meta-ads-dev`. Modul lain (01-99) HARUS pakai foundation untuk
> auth, config, database access, audit logging, error mapping, HTTP
> client base, snapshot reads, dan job dispatch.

## Why this exists

Sebelum 00-foundation, concerns yang sama (auth manager, audit logger,
error mapper, snapshot read patterns) tersebar di:
- `src/lib/auth-manager.ts`
- `src/lib/audit-logger.ts`
- `src/lib/error-mapper.ts`
- `src/config/env.ts`
- `src/db/index.ts`
- Snapshot reads duplicated di module 02, 11, 14, 15, 30 (~5 copy paste).

Foundation menyatukan jalur import. Kalau ada penambahan concern baru
(e.g. circuit breaker, rate limiter, distributed lock), ditaruh di sini
supaya tidak proliferasi.

## File map

```
00-foundation/
├── auth.ts                   # Re-export Meta token auth
├── config.ts                 # Re-export env config
├── database.ts               # Re-export Drizzle DB + lifecycle
├── audit.ts                  # Re-export operation_audits writers
├── error-mapper.ts           # Re-export Meta error normalizer
├── provider-client.ts        # Base HTTP wrapper (Meta/KIE/Sheets/etc.)
├── snapshot-repository.ts    # Generic snapshot reader
├── job-dispatcher.ts         # pg-boss wrapper
├── index.ts                  # Aggregated re-exports
├── blueprint.md              # This file
└── PRD.md                    # Detailed requirements + migration plan
```

## Provider client (V1 → V2)

**V1 (sekarang)** — base class `ProviderClient` dengan `request()`
helper. Modul lama yang punya HTTP wrapper sendiri TIDAK forced
migrate; mereka tetap jalan. Modul baru SANGAT didorong pakai
`ProviderClient` supaya retry + error mapping seragam.

**V2 (TODO)** — provider-specific subclass: `MetaProviderClient`
(inject Graph base URL + access_token), `KieProviderClient`,
`SheetsProviderClient`. Per-provider rate limit budgeting via
job-dispatcher.

## Job dispatcher (pg-boss)

Saat ini cron tetap di `/etc/cron.d/maa-*` untuk:
- `maa-optimizer` — runOptimizer per 3 jam
- `maa-meta-progress` — 3x sehari progress report
- `maa-sheets-daily` — 09:00 WIB Sheets daily report
- `maa-daily-summary` — 07:00 WIB morning summary
- `maa-sheets-alerts` — 07:00 WIB alert evaluation

Foundation menyediakan `job-dispatcher.ts` (pg-boss) untuk feature baru
yang butuh in-process queue (mis. KIE.ai task polling — long-running
async work yang nggak cocok untuk cron). Cron yang sudah ada **TIDAK
dimigrate dulu** — terlalu banyak risk untuk nilai marginal.

pg-boss schema = `pgboss` (terpisah dari `public`), jadi nggak conflict
dengan Drizzle migration kita.

## Tabel database

Foundation tidak own table-nya sendiri. Tapi dua tabel ini ditambahkan
sebagai bagian dari blueprint compliance:

| Tabel | Purpose | Owner module |
|---|---|---|
| `kie_tasks` | Lifecycle async KIE.ai task | 05-kie-image-generator (future) |
| `sync_cursors` | Per-(connection, object_type) cursor untuk delta sync | 01-manage-campaigns |

Tabel lain yang sudah ada tetap milik module aslinya.

## Migration roadmap

Lihat `PRD.md` untuk detail per-module migration plan.

Status awal (saat 00-foundation di-create):
- Foundation files exist sebagai re-export atau new abstractions
- Module lama BELUM forced migrate
- Pilot migration (Phase 5) update 2-3 modul as proof
- Bulk migration deferred — risk vs. value tradeoff

## Convention

Module baru HARUS:
```typescript
// ✅ Good — single import path
import { db, recordAudit, TokenInvalidError, appConfig } from '../00-foundation/index.js';

// ❌ Bad — bypass foundation
import { db } from '../../db/index.js';
import { recordAudit } from '../../lib/audit-logger.js';
```

Module lama (sebelum migration):
- Tetap pakai path lama untuk minimize churn
- Saat ada perubahan signifikan (lebih dari fix kecil), migrate sekaligus
