import { fmtDate, fmtRelative, html, safe, type SafeHtml } from '../html.js';
import { renderPage } from '../layout.js';
import type { AssetCounts } from '../data.js';
import type { ContentAsset } from '../../../db/schema/content-assets.js';

interface CreativesData {
  username: string;
  assets: ContentAsset[];
  counts: AssetCounts;
}

export function renderCreatives(data: CreativesData): string {
  const body = html`
    <h1>Creative library</h1>
    <p class="muted">Generated and edited image assets.</p>

    <div class="grid grid-3">
      ${countCard('Successful', data.counts.byStatus.success ?? 0)}
      ${countCard('In progress', (data.counts.byStatus.processing ?? 0) + (data.counts.byStatus.pending ?? 0))}
      ${countCard('Failed', data.counts.byStatus.failed ?? 0)}
    </div>

    <div class="card" style="margin-top:1.5rem; padding:0">
      ${data.assets.length === 0
        ? html`<div class="empty" style="padding:2rem 1rem">No image assets yet.</div>`
        : assetList(data.assets)}
    </div>
  `;
  return renderPage(
    { title: 'Creatives', active: 'creatives', username: data.username },
    body,
  );
}

function countCard(label: string, n: number): SafeHtml {
  return html`
    <div class="card">
      <div class="muted">${label}</div>
      <div class="stat">${n}</div>
    </div>
  `;
}

function assetList(assets: ContentAsset[]): SafeHtml {
  return html`
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Asset</th>
            <th>Type</th>
            <th>Status</th>
            <th>Result</th>
            <th>Created</th>
            <th>Expires</th>
          </tr>
        </thead>
        <tbody>${assets.map(assetRow)}</tbody>
      </table>
    </div>
  `;
}

function assetRow(a: ContentAsset): SafeHtml {
  const urls = Array.isArray(a.resultUrls)
    ? (a.resultUrls as unknown[]).filter((u): u is string => typeof u === 'string')
    : [];
  const preview = urls.slice(0, 3).map(
    (url) => html`
      <a href="${url}" target="_blank" rel="noopener" class="badge" style="display:inline-block;margin:2px">view</a>
    `,
  );
  return html`
    <tr>
      <td>
        <strong>${truncate(a.prompt ?? '(no prompt)', 80)}</strong>
        <div class="muted">${a.id}</div>
      </td>
      <td>${typeBadge(a.assetType)}</td>
      <td>${statusBadge(a.status)}</td>
      <td>${urls.length > 0 ? html`${preview}` : safe('—')}</td>
      <td class="muted">${fmtRelative(a.createdAt)}</td>
      <td class="muted">${a.expiresAt ? fmtDate(a.expiresAt) : '—'}</td>
    </tr>
  `;
}

function typeBadge(t: string): SafeHtml {
  if (t === 'image_generated') return html`<span class="badge">generated</span>`;
  if (t === 'image_edited') return html`<span class="badge">edited</span>`;
  return html`<span class="badge">${t}</span>`;
}

function statusBadge(s: string): SafeHtml {
  if (s === 'success') return html`<span class="badge good">success</span>`;
  if (s === 'failed') return html`<span class="badge bad">failed</span>`;
  if (s === 'processing' || s === 'pending')
    return html`<span class="badge warn">${s}</span>`;
  if (s === 'expired') return html`<span class="badge">expired</span>`;
  return html`<span class="badge">${s}</span>`;
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}
