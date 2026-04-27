import { html, safe, type SafeHtml } from '../html.js';
import { renderPage } from '../layout.js';
import type { AudienceListResult, AudienceRow } from '../data.js';
import type { MetaConnection } from '../../../db/schema/meta-connections.js';

interface AudiencesData {
  username: string;
  result: AudienceListResult;
  connections: MetaConnection[];
  filterConnectionId: string;
}

export function renderAudiences(data: AudiencesData): string {
  const totalSize = data.result.rows.reduce(
    (acc, r) => acc + (r.approximateCount ?? 0),
    0,
  );
  const lalCount = data.result.rows.filter(
    (r) => (r.subtype ?? '').toUpperCase() === 'LOOKALIKE',
  ).length;
  const customCount = data.result.rows.length - lalCount;

  const body = html`
    <h1>Audience manager</h1>
    <p class="muted">Custom audiences pulled live from Meta for every active ad account.</p>

    <div class="grid grid-3">
      ${countCard('Custom audiences', customCount)}
      ${countCard('Lookalike audiences', lalCount)}
      ${countCard('Combined reach (approx)', formatNumber(totalSize))}
    </div>

    <div class="card" style="margin-top:1.5rem">
      <form method="GET" action="/audiences" class="inline">
        <label>Account
          <select name="connectionId">
            <option value=""${data.filterConnectionId === '' ? safe(' selected') : safe('')}>All accounts</option>
            ${data.connections.map(
              (c) => html`<option value="${c.id}"${data.filterConnectionId === c.id ? safe(' selected') : safe('')}>${c.accountName}</option>`,
            )}
          </select>
        </label>
        <button type="submit">Filter</button>
        <a class="btn subtle" href="/audiences">Reset</a>
        <a class="btn" href="https://www.facebook.com/adsmanager/audiences" target="_blank" rel="noopener">+ Create in Ads Manager</a>
      </form>
      <p class="muted" style="margin:0.75rem 0 0;font-size:0.8rem">
        Tip: audiences are also created automatically by the optimizer (engagement + lookalike).
        For one-off custom files, use Meta's Ads Manager.
      </p>
    </div>

    ${data.result.errors.length > 0
      ? html`
          <div class="alert error" style="margin-top:1rem">
            <strong>Some accounts could not be synced:</strong>
            <ul style="margin:0.5rem 0 0;padding-left:1.25rem">
              ${data.result.errors.map(
                (e) => html`<li>${e.accountName}: ${e.message}</li>`,
              )}
            </ul>
          </div>
        `
      : safe('')}

    <div class="card" style="margin-top:1.5rem;padding:0">
      ${data.result.rows.length === 0
        ? html`<div class="empty" style="padding:2rem 1rem">No audiences found.</div>`
        : audienceTable(data.result.rows)}
    </div>
  `;
  return renderPage(
    {
      title: 'Audiences',
      active: 'audiences',
      username: data.username,
      crumbs: [{ href: '/', label: 'Home' }, { label: 'Audiences' }],
    },
    body,
  );
}

function countCard(label: string, value: string | number): SafeHtml {
  return html`
    <div class="card">
      <div class="muted">${label}</div>
      <div class="stat">${value}</div>
    </div>
  `;
}

function audienceTable(rows: AudienceRow[]): SafeHtml {
  return html`
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Account</th>
            <th>Type</th>
            <th>Approx size</th>
            <th>Delivery</th>
            <th>Operation</th>
          </tr>
        </thead>
        <tbody>${rows.map(audienceRow)}</tbody>
      </table>
    </div>
  `;
}

function audienceRow(a: AudienceRow): SafeHtml {
  return html`
    <tr>
      <td>
        <strong>${a.name}</strong>
        <div class="muted">${a.audienceId}</div>
      </td>
      <td>
        ${a.accountName}
        <div class="muted">act_${a.adAccountId}</div>
      </td>
      <td>${typeBadge(a.subtype)}</td>
      <td>${formatNumber(a.approximateCount)}</td>
      <td>${deliveryBadge(a.deliveryStatus)}</td>
      <td>${operationBadge(a.operationStatus)}</td>
    </tr>
  `;
}

function typeBadge(t: string | null): SafeHtml {
  const v = (t ?? '').toUpperCase();
  if (v === 'LOOKALIKE') return html`<span class="badge">lookalike</span>`;
  if (v === 'CUSTOM') return html`<span class="badge">custom</span>`;
  if (v === 'ENGAGEMENT') return html`<span class="badge">engagement</span>`;
  if (v === 'WEBSITE') return html`<span class="badge">website</span>`;
  if (!v) return html`<span class="badge">—</span>`;
  return html`<span class="badge">${v.toLowerCase()}</span>`;
}

function deliveryBadge(s: string | null): SafeHtml {
  if (!s) return safe('—');
  const v = s.toLowerCase();
  if (v.includes('ready') || v === 'active')
    return html`<span class="badge good">${v}</span>`;
  if (v.includes('error') || v.includes('not_ready'))
    return html`<span class="badge bad">${v}</span>`;
  return html`<span class="badge warn">${v}</span>`;
}

function operationBadge(raw: string | null): SafeHtml {
  if (!raw) return safe('—');
  // Meta returns operation_status as JSON object string like {"code":300,"description":"..."}
  let label = raw;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === 'object' &&
      'description' in parsed &&
      typeof (parsed as { description: unknown }).description === 'string'
    ) {
      label = (parsed as { description: string }).description;
    }
  } catch {
    /* keep raw */
  }
  const v = label.toLowerCase();
  if (v.includes('normal') || v.includes('ready'))
    return html`<span class="badge good">${label}</span>`;
  if (v.includes('error') || v.includes('warning'))
    return html`<span class="badge bad">${label}</span>`;
  return html`<span class="badge">${label}</span>`;
}

function formatNumber(n: number | null): string {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
