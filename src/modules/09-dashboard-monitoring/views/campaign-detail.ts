import { fmtRelative, html, type SafeHtml } from '../html.js';
import { renderPage } from '../layout.js';
import type { CampaignDetailData } from '../data.js';
import type { MetaObjectSnapshot } from '../../../db/schema/meta-object-snapshots.js';

interface DetailViewData {
  username: string;
  campaignId: string;
  detail: CampaignDetailData;
}

export function renderCampaignDetail(data: DetailViewData): string {
  const c = data.detail.campaign;
  if (!c) {
    const body = html`
      <h1>Campaign not found</h1>
      <div class="card empty">No snapshot exists for id <code>${data.campaignId}</code>.</div>
    `;
    return renderPage(
      {
        title: 'Campaign',
        active: 'campaigns',
        username: data.username,
        crumbs: [
          { href: '/', label: 'Home' },
          { href: '/campaigns', label: 'Campaigns' },
          { label: 'Not found' },
        ],
      },
      body,
    );
  }

  const adSetSections = data.detail.adSets.map(({ snapshot, ads }) =>
    renderAdSetSection(snapshot, ads),
  );

  const body = html`
    <h1>${c.name || '(no name)'}</h1>
    <div class="pill-row" style="margin-bottom:1rem">
      ${statusBadge(c.status)} ${effectiveBadge(c.effectiveStatus)}
      <span class="muted">id ${c.objectId}</span>
      <span class="muted">synced ${fmtRelative(c.fetchedAt)}</span>
    </div>
    ${data.detail.adSets.length === 0
      ? html`<div class="card empty">No ad sets synced under this campaign yet.</div>`
      : html`<div class="grid">${adSetSections}</div>`}
  `;
  return renderPage(
    {
      title: c.name || 'Campaign',
      active: 'campaigns',
      username: data.username,
      crumbs: [
        { href: '/', label: 'Home' },
        { href: '/campaigns', label: 'Campaigns' },
        { label: c.name || c.objectId },
      ],
    },
    body,
  );
}

function renderAdSetSection(
  snapshot: MetaObjectSnapshot,
  ads: MetaObjectSnapshot[],
): SafeHtml {
  return html`
    <div class="card">
      <div class="pill-row" style="justify-content:space-between">
        <div>
          <h3 style="margin:0">${snapshot.name || '(no name)'}</h3>
          <div class="muted">${snapshot.objectId}</div>
        </div>
        <div class="pill-row">
          ${statusBadge(snapshot.status)} ${effectiveBadge(snapshot.effectiveStatus)}
        </div>
      </div>
      ${ads.length === 0
        ? html`<div class="empty" style="padding:1rem">No ads under this ad set.</div>`
        : html`
          <div class="table-wrap">
            <table>
              <thead><tr><th>Ad</th><th>Status</th><th>Delivery</th><th>Synced</th></tr></thead>
              <tbody>${ads.map(adRow)}</tbody>
            </table>
          </div>
        `}
    </div>
  `;
}

function adRow(ad: MetaObjectSnapshot): SafeHtml {
  return html`
    <tr>
      <td>
        <strong>${ad.name || '(no name)'}</strong>
        <div class="muted">${ad.objectId}</div>
      </td>
      <td>${statusBadge(ad.status)}</td>
      <td>${effectiveBadge(ad.effectiveStatus)}</td>
      <td class="muted">${fmtRelative(ad.fetchedAt)}</td>
    </tr>
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
  if (!s) return html`<span class="badge">unknown</span>`;
  const lower = s.toLowerCase().replace(/_/g, ' ');
  if (s === 'ACTIVE') return html`<span class="badge good">delivering</span>`;
  if (s === 'DISAPPROVED' || s === 'WITH_ISSUES')
    return html`<span class="badge bad">${lower}</span>`;
  if (s === 'PENDING_REVIEW' || s === 'IN_PROCESS' || s === 'PENDING_BILLING_INFO')
    return html`<span class="badge warn">${lower}</span>`;
  return html`<span class="badge">${lower}</span>`;
}
