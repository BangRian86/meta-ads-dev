# MEMORY.md

Kebijakan penyimpanan memori persisten yang dipakai sistem
`meta-ads-dev`. Memori di sini berbeda dengan memory Claude Code
(yang ada di `~/.claude/projects/-root-meta-ads-dev/memory/`) — file
ini menjelaskan **memori run-time aplikasi**: tabel database mana
yang menjadi long-term memory tiap modul, plus konvensi penulisan.

> Update file ini saat tambah tabel baru atau ubah kebijakan retention.

---

## 1. Lokasi memori

### 1a. Memory aplikasi — Postgres (skema `public`)

Tabel-tabel yang berfungsi sebagai memory persisten lintas request /
cron / restart:

| Tabel | Tipe memory | Owner module | Retensi |
|---|---|---|---|
| `meta_connections` | Credential + status | 00-foundation | Forever (manual delete) |
| `kie_credentials` | Credential KIE | 05-kie-image-generator | Forever (manual rotate) |
| `meta_object_snapshots` | Snapshot campaign/adset/ad | 01-manage-campaigns | TTL by query (latest per id) |
| `meta_insight_snapshots` | Cache insight per (target, range) | 02-ads-analysis | TTL `insightSnapshotTtlMs` (env) |
| `meta_request_logs` | Audit HTTP call ke Meta | 00-foundation | Forever (analytics) |
| `meta_rule_drafts` | Draft rule sebelum publish | 07-rules-management | Until publish/discard |
| `meta_rule_snapshots` | Versi rule per perubahan | 07-rules-management | Forever (audit) |
| `operation_audits` | Audit setiap operasi | 00-foundation | Forever |
| `content_assets` | Image/video library | 05/08 generator | Until expiry (default 14 hari) |
| `kie_tasks` | Task lifecycle KIE | 05/08 generator | Mirror content_assets |
| `copy_briefs` | Brief copy | 06-copywriting-lab | Forever (manual delete) |
| `copy_variants` | Variant copy + review | 06-copywriting-lab | Forever |
| `pending_actions` | Approval queue | 12-approval-queue | TTL 24h |
| `closing_records` | Manual closing entry | 15-closing-tracker | Forever |
| `alert_dedupe` | Dedupe key + last_sent | 17-anomaly-alerts | Forever (cooldown 6h) |
| `ai_usage_logs` | Token + USD cost Claude | 10-telegram-bot, 06 | Forever (cost analytics) |
| `sync_cursors` | Per-(connection, type) cursor | (deferred) | TBD — placeholder |

### 1b. Memory cache di-process (in-memory, ephemeral)

Hilang saat restart server:

| Singleton | File | Tujuan |
|---|---|---|
| Telegraf bot | `10-telegram-bot/bot.ts` | Polling loop |
| Sender Telegraf | `00-foundation/notifications.ts` | Outbound only |
| Anthropic client | `10-telegram-bot/ai-handler.ts` + `06/ai-generator.ts` | Reuse HTTP keep-alive |
| Sheets client | `13-sheets-integration/client.ts` + `30-sheets-reader/sheets-client.ts` | Auth keep-alive |
| pg-boss instance | `00-foundation/job-dispatcher.ts` | Background queue |
| CS perform cache | `30-sheets-reader/cs-data.ts` | Refresh via `/refresh_cs` |

### 1c. Memory cron — file system

Cron tidak punya in-process memory; "last run" diturunkan dari mtime
log file:

| File | Penanda |
|---|---|
| `/tmp/maa-optimizer.log` | Last optimizer run |
| `/tmp/maa-meta-progress.log` | Last progress report |
| `/tmp/maa-sheets-alerts.log` | Last sheets alert |
| `/tmp/maa-sheets-daily.log` | Last sheets daily |
| `/tmp/maa-daily-summary.log` | Last daily summary |

### 1d. Memory secret — `.env`

Tidak boleh masuk git. Semua secret di-load lewat `config/env.ts`
dan diakses via `00-foundation` `appConfig`.

---

## 2. Kebijakan retensi

### 2a. Audit — forever
`operation_audits`, `meta_request_logs`, `meta_rule_snapshots`,
`copy_variants`, `ai_usage_logs`, `closing_records`, `alert_dedupe`
**tidak di-prune** — diasumsikan size tractable; kalau tabel sudah
> 100M baris, baru bahas archival policy.

### 2b. Snapshot — TTL by query
`meta_object_snapshots`, `meta_insight_snapshots` di-write berkali-kali
per (id, range). Read pakai `findLatestSnapshot` (sort by `fetched_at` /
`created_at`). Tidak ada cron pruning sekarang — disk usage rendah
relatif.

### 2c. Asset library — TTL 14 hari
`content_assets`, `kie_tasks` punya `expires_at` (default 14 hari sejak
create). Field `defaultExpiry()` di asset-store. Marking expired
(`status='expired'`) lewat `markExpiredAssets` — belum di-cron.

### 2d. Approval queue — TTL 24h
`pending_actions.expires_at` default 24h. Action yang lewat TTL
**tidak akan execute**, tapi row tetap ada untuk audit trail.

### 2e. Alert dedupe — cooldown 6h
`alert_dedupe.last_sent_at` di-cek lebih kecil dari 6 jam → skip
notify ulang. Row di-upsert pada setiap fire.

### 2f. Cache insight — TTL env-driven
`config.insightSnapshotTtlMs` (default kemungkinan 60 menit).
`getOrFetchSnapshot` cek umur snapshot.

---

## 3. Konvensi penulisan

### 3a. Wajib `withAudit` untuk write Meta
Setiap mutation Meta API (create / update / delete / status / budget)
**wajib** dibungkus `withAudit` dari `00-foundation`. Audit row
otomatis include `previousState` + `newState` + duration + actor.

```typescript
import { withAudit } from '../00-foundation/index.js';

await withAudit(
  {
    connectionId,
    operationType: 'campaign.pause',
    targetType: 'campaign',
    targetId,
    actorId,
    requestBody: { /* serialized */ },
  },
  async () => {
    // actual work
    return result;
  },
  (r) => r.id, // map result → targetId untuk row
);
```

### 3b. HTTP call ke external API → `meta_request_logs`
Setiap fetch ke Meta / KIE / Sheets manual log via helper di
`meta-rules.ts` / `meta-budget.ts` / dll. Field: `connectionId`, `path`,
`payload`, `httpStatus`, `durationMs`.

### 3c. Snapshot bukan mutation result
Setelah Meta write berhasil, **panggil sync ulang** untuk dapat
snapshot fresh. Jangan inject return value Meta langsung sebagai
snapshot — bisa miss field yang Meta hitung sendiri.

### 3d. Idempotency
Operasi yang bisa di-retry harus idempotent:
- `pause / unpause` → noop kalau sudah di state target
- KIE callback handler → kalau task sudah terminal, skip
- `markExpiredAssets` → idempotent by design
- `enqueue` approval action → tidak ada dedupe; caller pastikan tidak
  enqueue duplikat (atau pakai `findOnlyLivePending`)

### 3e. Memory ephemeral untuk cache, persistent untuk audit
Aturan:
- Cache (insight, sheets, snapshots) → Postgres dengan TTL.
- Audit (apa yang dilakukan, oleh siapa) → Postgres tanpa TTL.
- Lifecycle state (in-process counters, queues) → in-memory singleton
  + checkpoint ke Postgres saat boundary.

### 3f. Auto-detect brand dari nama
`detectBrand(name)` (di `14-meta-progress`, type re-exported di
`00-foundation/types`) match substring "aqiqah" / "basmalah" /
"umroh" case-insensitive. Konvensi naming wajib diikuti tim media
buyer agar otomatisasi (benchmark, ROAS threshold, AI context)
bekerja.

### 3g. Dedupe key — `kind:campaignId`
Untuk `alert_dedupe`, key adalah `<kind>:<campaignId>` (misal
`spend_drop:123`). Mencegah spam alert sama untuk campaign sama dalam
window cooldown.

---

## 4. Memory yang tidak boleh di-write

- **Secrets di kode** — semua via env / `appConfig`.
- **PII pelanggan** — sistem ini tidak proses PII end-customer; kalau
  butuh dipanggil ke depannya, tambah field encrypted at-rest dulu.
- **Token Meta full** di log — `meta_request_logs` tidak boleh include
  `access_token` di payload. Helper di `00-foundation/error-mapper`
  redact otomatis. Tetap jaga manual untuk endpoint baru.
- **Prompt user yang sensitif** ke Claude tanpa redaction — flow AI
  cuma boleh kirim metadata campaign + benchmark, bukan personal data.

---

## 5. Pruning manual (kalau perlu)

Belum ada cron prune. Kalau di kemudian hari tabel besar:

```sql
-- meta_request_logs > 90 hari (analytics jarang query yang tua)
DELETE FROM meta_request_logs WHERE created_at < now() - interval '90 days';

-- pending_actions yang expired > 30 hari
DELETE FROM pending_actions WHERE expires_at < now() - interval '30 days' AND status IN ('executed','failed','rejected');

-- alert_dedupe yang last_sent_at > 30 hari (sudah pasti kembali fire)
DELETE FROM alert_dedupe WHERE last_sent_at < now() - interval '30 days';
```

Run satu kali manual atau setup cron baru di `/etc/cron.d/maa-prune`.
