import { fmtRelative, html, type SafeHtml } from '../html.js';
import { renderPage } from '../layout.js';
import type { CampaignRow } from '../data.js';

interface CampaignsData {
  username: string;
  campaigns: CampaignRow[];
}

export function renderCampaigns(data: CampaignsData): string {
  const body = html`
    <h1>Campaigns</h1>
    <p class="muted">Latest known state from synced snapshots.</p>
    ${data.campaigns.length === 0
      ? html`<div class="card empty">No campaigns synced yet.</div>`
      : campaignTable(data.campaigns)}
  `;
  return renderPage(
    { title: 'Campaigns', active: 'campaigns', username: data.username },
    body,
  );
}

function campaignTable(rows: CampaignRow[]): SafeHtml {
  const trs = rows.map(
    (r) => html`
      <tr>
        <td>
          <a href="/campaigns/${encodeURIComponent(r.snapshot.objectId)}">
            <strong>${r.snapshot.name || '(no name)'}</strong>
          </a>
          <div class="muted">${r.snapshot.objectId}</div>
        </td>
        <td>${statusBadge(r.snapshot.status)}</td>
        <td>${effectiveBadge(r.snapshot.effectiveStatus)}</td>
        <td>${r.adSetCount}</td>
        <td class="muted">${fmtRelative(r.snapshot.fetchedAt)}</td>
      </tr>
    `,
  );
  return html`
    <div class="card" style="padding:0">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Campaign</th>
              <th>Status</th>
              <th>Delivery</th>
              <th>Ad sets</th>
              <th>Synced</th>
            </tr>
          </thead>
          <tbody>${trs}</tbody>
        </table>
      </div>
    </div>
  `;
}

function statusBadge(status: string): SafeHtml {
  if (status === 'ACTIVE') return html`<span class="badge good">active</span>`;
  if (status === 'PAUSED') return html`<span class="badge warn">paused</span>`;
  if (status === 'DELETED' || status === 'ARCHIVED')
    return html`<span class="badge bad">${status.toLowerCase()}</span>`;
  return html`<span class="badge">${status.toLowerCase()}</span>`;
}

function effectiveBadge(s: string): SafeHtml {
  const lower = s.toLowerCase();
  if (s === 'ACTIVE') return html`<span class="badge good">delivering</span>`;
  if (s === 'DISAPPROVED' || s === 'WITH_ISSUES')
    return html`<span class="badge bad">${lower.replace('_', ' ')}</span>`;
  if (s === 'PENDING_REVIEW' || s === 'IN_PROCESS' || s === 'PENDING_BILLING_INFO')
    return html`<span class="badge warn">${lower.replace(/_/g, ' ')}</span>`;
  return html`<span class="badge">${lower.replace(/_/g, ' ')}</span>`;
}
