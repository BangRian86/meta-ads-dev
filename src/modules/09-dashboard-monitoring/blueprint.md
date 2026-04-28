# Blueprint — 09-dashboard-monitoring

## Tujuan
Web UI minimal (no SPA, server-rendered HTML) untuk monitoring dan
admin Meta Ads Console: overview activity, campaign tree, creative
library, audience manager, workflow explorer, dan settings (token /
API key).

## File & Fungsi

| File | Fungsi |
|------|--------|
| `auth.ts` | Cookie session HMAC-signed. `createSessionCookie / readSession / verifyCredentials / requireAuth` (preHandler Fastify). |
| `html.ts` | Tagged template `html` + `safe` (auto-escape XSS), `fmtDate / fmtRelative / maskSecret` helpers. |
| `layout.ts` | `renderPage(opts, body)` master shell — topbar nav, breadcrumbs, mobile-collapsible nav. CSS inline + script nav-toggle. `NavKey` (home/campaigns/creatives/audiences/workflows/settings). |
| `data.ts` | Query layer: `listMetaConnections`, `listKieCredentials`, `recentAudits`, `activitySummary`, `listCampaigns`, `campaignDetail`, `listAssetsFiltered` (filter type/status/akun + pagination), `assetCounts`, `listAudiences` (live Meta API), `workflowComponents`, `cronJobsStatus`, plus mutations (addMetaConnection, setMetaConnectionToken/Name, addKieCredential, setKieCredentialKey). |
| `views/login.ts` | Login form + offline notice (kalau dashboard tidak dikonfigurasi). |
| `views/home.ts` | `/` — overview cards (operations 24h, API calls 1h, in-flight images), tabel ad accounts + KIE keys + recent audit. |
| `views/campaigns.ts` | `/campaigns` — list semua campaign dari `meta_object_snapshots`. |
| `views/campaign-detail.ts` | `/campaigns/:id` — campaign + adsets + ads tree. |
| `views/creatives.ts` | `/creatives` — asset grid (image/video preview, download), filter (type/status/akun), pagination 20. |
| `views/audiences.ts` | `/audiences` — custom audiences dari semua connection (live Meta API), filter per akun. |
| `views/workflows.ts` | `/workflows` — flow diagram Sync → Analyze → Optimize → Notify → Approve → Execute + tabel cron job status (read mtime `/tmp/maa-*.log`). |
| `views/settings.ts` | `/settings` — manage Meta connections (add/replace token/rename) dan KIE credentials. |
| `routes.ts` | Fastify plugin `dashboardRoutes` — semua route + form-urlencoded body parser + auth gating. |
| `index.ts` | Barrel export `dashboardRoutes` + auth helpers. |

## Dependensi

- **Modul lain:** `config/env` (dashboard config), `db/index`,
  semua schema (read-mostly), lazy-import `18-audience-builder`
  untuk `listMetaAudiences` (dipindah dari `11-auto-optimizer/audience-creator` April 2026).
- **Tabel database:** read-mostly — `meta_connections`, `kie_credentials`,
  `operation_audits`, `meta_request_logs`, `meta_object_snapshots`,
  `content_assets`. Mutations terbatas: connections + KIE creds.
- **External:** Fastify framework. Meta Graph API (lewat `18-audience-builder`).

## Cara Penggunaan

```typescript
// src/server.ts
import { dashboardRoutes } from './modules/09-dashboard-monitoring/index.js';
await app.register(dashboardRoutes);

// Plugin self-gate: kalau DASHBOARD_PASSWORD / DASHBOARD_SESSION_SECRET
// belum di-set, route /login render "offline" dan endpoint lain skip.
```

Akses:
- `GET /login` — form login (cek `DASHBOARD_USERNAME` + `DASHBOARD_PASSWORD`).
- `GET /` — home (auth required).
- `GET /campaigns`, `/creatives?type=image&status=success&page=2`,
  `/audiences?connectionId=...`, `/workflows`, `/settings`.
- `POST /settings/meta` (add), `/settings/meta/replace` (token rotate),
  `/settings/meta/rename`, `/settings/kie`, `/settings/kie/replace`.

## Catatan Penting

- **Server-rendered HTML, no JS framework** — pure tagged templates +
  inline CSS + 1 small script untuk nav toggle. Footprint kecil, easy
  to maintain.
- **Auto-escape via `html` template tag** — semua interpolasi HTML
  di-escape default. Pakai `safe()` untuk inject pre-rendered fragment.
- **Session cookie HMAC** — signed dengan `DASHBOARD_SESSION_SECRET`,
  `HttpOnly + SameSite=Strict`, TTL configurable.
- **Auth gating module-level** — kalau `config.dashboard.isConfigured`
  false, plugin tidak register route protected.
- **`/audiences` live ke Meta** — pakai `listMetaAudiences` dari
  `18-audience-builder` (lazy-import). Per-akun error di-tampilkan di
  banner, akun lain tetap di-render.
- **`/workflows` cron status** — derived dari mtime
  `/tmp/maa-*.log`. Bukan dari pg-boss (cron masih di `/etc/cron.d/`).
- **Mobile-friendly** — nav collapsible di ≤720px, table horizontal-scroll wrap.
