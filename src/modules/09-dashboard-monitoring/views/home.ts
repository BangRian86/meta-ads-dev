import { fmtRelative, html, safe, type SafeHtml } from '../html.js';
import { renderPage } from '../layout.js';
import type {
  ActivitySummary,
} from '../data.js';
import type { MetaConnection } from '../../../db/schema/meta-connections.js';
import type { KieCredential } from '../../../db/schema/kie-credentials.js';
import type { OperationAudit } from '../../../db/schema/operation-audits.js';

interface HomeData {
  username: string;
  metaConnections: MetaConnection[];
  kieCredentials: KieCredential[];
  activity: ActivitySummary;
  recentAudits: OperationAudit[];
}

export function renderHome(data: HomeData): string {
  const body = html`
    <h1>Overview</h1>

    <div class="grid grid-3">
      ${stat('Operations (24h)', `${data.activity.successLastDay} succeeded`, `${data.activity.failureLastDay} failed`)}
      ${stat('API calls (1h)', String(data.activity.recentMetaCallsLastHour), 'Provider requests')}
      ${stat('In-flight images', String(data.activity.processingAssets + data.activity.pendingAssets), `${data.activity.processingAssets} processing, ${data.activity.pendingAssets} queued`)}
    </div>

    <div class="grid grid-2" style="margin-top:1.5rem">
      <div class="card">
        <h2>Ad accounts</h2>
        ${renderConnectionsTable(data.metaConnections)}
      </div>
      <div class="card">
        <h2>Image provider keys</h2>
        ${renderKieTable(data.kieCredentials)}
      </div>
    </div>

    <div class="card" style="margin-top:1.5rem">
      <h2>Recent activity</h2>
      ${renderAuditsTable(data.recentAudits)}
    </div>
  `;
  return renderPage({ title: 'Overview', active: 'home', username: data.username }, body);
}

function stat(label: string, value: string, sub: string): SafeHtml {
  return html`
    <div class="card">
      <div class="muted">${label}</div>
      <div class="stat">${value}</div>
      <div class="muted">${sub}</div>
    </div>
  `;
}

function renderConnectionsTable(rows: MetaConnection[]): SafeHtml {
  if (rows.length === 0) {
    return html`<div class="empty">No ad accounts connected. Add one in <a href="/settings">Settings</a>.</div>`;
  }
  const trs = rows.map(
    (r) => html`
      <tr>
        <td>
          <strong>${r.accountName}</strong>
          <div class="muted">act_${r.adAccountId}</div>
        </td>
        <td>${statusBadge(r.status)}</td>
        <td class="muted">${fmtRelative(r.lastValidatedAt)}</td>
      </tr>
    `,
  );
  return html`
    <div class="table-wrap">
      <table>
        <thead><tr><th>Account</th><th>Status</th><th>Validated</th></tr></thead>
        <tbody>${trs}</tbody>
      </table>
    </div>
  `;
}

function renderKieTable(rows: KieCredential[]): SafeHtml {
  if (rows.length === 0) {
    return html`<div class="empty">No image keys configured. Add one in <a href="/settings">Settings</a>.</div>`;
  }
  const trs = rows.map(
    (r) => html`
      <tr>
        <td><strong>${r.label}</strong></td>
        <td>${statusBadge(r.status)}</td>
        <td class="muted">${fmtRelative(r.lastValidatedAt)}</td>
      </tr>
    `,
  );
  return html`
    <div class="table-wrap">
      <table>
        <thead><tr><th>Label</th><th>Status</th><th>Validated</th></tr></thead>
        <tbody>${trs}</tbody>
      </table>
    </div>
  `;
}

function renderAuditsTable(rows: OperationAudit[]): SafeHtml {
  if (rows.length === 0) {
    return html`<div class="empty">No recent activity yet.</div>`;
  }
  const trs = rows.slice(0, 25).map((r) => {
    const target = r.targetId ? `${r.targetType} ${r.targetId}` : r.targetType;
    return html`
      <tr>
        <td class="muted">${fmtRelative(r.createdAt)}</td>
        <td><code>${r.operationType}</code></td>
        <td>${target}</td>
        <td>${outcomeBadge(r.status)}</td>
      </tr>
    `;
  });
  return html`
    <div class="table-wrap">
      <table>
        <thead><tr><th>When</th><th>Operation</th><th>Target</th><th>Outcome</th></tr></thead>
        <tbody>${trs}</tbody>
      </table>
    </div>
  `;
}

function statusBadge(status: string): SafeHtml {
  if (status === 'active') return html`<span class="badge good">${status}</span>`;
  if (status === 'invalid' || status === 'credits_exhausted')
    return html`<span class="badge bad">${humanizeStatus(status)}</span>`;
  if (status === 'expired' || status === 'revoked')
    return html`<span class="badge warn">${status}</span>`;
  return html`<span class="badge">${status}</span>`;
}

function outcomeBadge(s: string): SafeHtml {
  if (s === 'success') return html`<span class="badge good">success</span>`;
  if (s === 'failed') return html`<span class="badge bad">failed</span>`;
  return html`<span class="badge">${s}</span>`;
}

function humanizeStatus(s: string): string {
  return s.replace(/_/g, ' ');
}
