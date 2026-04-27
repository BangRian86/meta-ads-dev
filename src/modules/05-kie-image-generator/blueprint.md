# Blueprint — 05-kie-image-generator

## Tujuan
Generate dan edit gambar via KIE.ai (provider AI image), dengan
lifecycle async: submit task → mirror ke `content_assets` + `kie_tasks`
→ tunggu webhook callback atau polling → simpan result URL + expiry.

## File & Fungsi

| File | Fungsi |
|------|--------|
| `schema.ts` | `KieAssetType`, `KieAssetStatus`, `KieSize`, input schemas (generate, edit, poll), `kieCallbackPayloadSchema`. |
| `kie-credentials.ts` | `requireActiveKieCredential` (load key dari `kie_credentials`), `markKieCredentialFailure` (status=invalid/credits_exhausted), `replaceKieKey`, `recordValidatedAt`. `KieCredentialError` class. |
| `kie-client.ts` | `submitImageTask` (POST ke KIE), `fetchTaskDetail` (GET status), `pluckResultUrls`. Map response status ke `KieTaskStatus` (pending/processing/success/failed). Log ke `meta_request_logs`. |
| `asset-store.ts` | CRUD `content_assets`: `createPendingAsset`, `findAsset`, `findAssetByProviderTask`, `updateAsset`, `listInflightAssets`, `markExpiredAssets`, `defaultExpiry`. |
| `task-mirror.ts` | Sinkronisasi `content_assets` ↔ `kie_tasks` (parallel record untuk lifecycle + billing analytics). Helpers `mirrorTaskPending / Succeeded / Failed`. |
| `poller.ts` | `pollAsset` (one-shot), `pollByAssetId`, `pollByProviderTask`, `pollAllInflight`. Idempoten — safe call berulang. |
| `callback-handler.ts` | `processCallback(rawPayload)` — terima webhook KIE, validasi, update asset. Outcome: `updated / unknown_task / noop`. |
| `bootstrap.ts` | `ensureKieCredentialFromEnv` — seed `kie_credentials` dari `KIE_API_KEY` env (idempotent, support key rotation). |
| `telegram-flow.ts` | `generateImageForTelegram` — facade khusus untuk bot Telegram (submit + poll sampai selesai/timeout, mirror ke `kie_tasks`). |
| `service.ts` | Public facade `submitGeneration / submitEdit / pollTask` (dengan `withAudit`). |
| `index.ts` | Barrel export. |

## Dependensi

- **Modul lain:** `00-foundation` (db, logger, appConfig), `lib/audit-logger`, `config/env`.
- **Tabel database:** `content_assets` (CRUD), `kie_tasks` (mirror), `kie_credentials` (read+update), `meta_request_logs` (write), `operation_audits` (write), `meta_connections` (read).
- **External API:** KIE.ai REST (`/playground/nano-banana`, `/gpt4o-image` — image generate/edit). Webhook callback dari KIE → handler.

## Cara Penggunaan

```typescript
import {
  submitGeneration,
  pollTask,
  generateImageForTelegram,
  ensureKieCredentialFromEnv,
} from '../05-kie-image-generator/index.js';

// Submit generate (async, return asset+taskId)
const { asset, providerTaskId } = await submitGeneration({
  connectionId,
  prompt: 'Foto produk umroh, golden hour',
  size: '1:1',
  actorId: 'tg:rian',
});

// Polling manual (atau biarkan callback yang handle)
const r = await pollTask({ assetId: asset.id });
if (r.asset.status === 'success') console.log(r.asset.resultUrls);

// One-shot dari Telegram
const result = await generateImageForTelegram({
  prompt: '...',
  size: '1:1',
  actorId: 'tg:rian',
});
```

## Catatan Penting

- **Lifecycle async** — submit return immediately dengan asset
  `status='pending'`. Status ter-update via callback (push) atau
  polling (pull). Callback lebih hemat tapi modul tetap support polling
  sebagai fallback.
- **Mirror `content_assets` ↔ `kie_tasks`** — design choice agar
  `content_assets` jadi media library single source-of-truth, sedangkan
  `kie_tasks` jadi audit trail per task dengan provider info dan billing.
- **Expiry default 14 hari** — KIE-hosted URL biasanya expired,
  `defaultExpiry()` set timestamp. Cron / job lain bisa
  `markExpiredAssets()` periodik.
- **Credential bootstrap idempotent** — `ensureKieCredentialFromEnv`
  insert atau update row label "env-bootstrap" kalau key di env berubah.
- **Error class `KieCredentialError`** tahu reason: `no_active_key`,
  `invalid_key`, `credits_exhausted`. Saat detected, modul auto-mark
  credential `invalid` / `credits_exhausted` di tabel.
- **Callback idempotent** — kalau task sudah terminal, `processCallback`
  noop (return outcome `noop`).
