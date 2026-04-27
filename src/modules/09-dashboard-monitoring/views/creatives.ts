import { fmtDate, fmtRelative, html, safe, type SafeHtml } from '../html.js';
import { renderPage } from '../layout.js';
import type {
  AssetCounts,
  AssetStatusFilter,
  AssetTypeFilter,
  PaginatedAssets,
} from '../data.js';
import type { ContentAsset } from '../../../db/schema/content-assets.js';
import type { MetaConnection } from '../../../db/schema/meta-connections.js';

interface CreativesData {
  username: string;
  assets: PaginatedAssets;
  counts: AssetCounts;
  connections: MetaConnection[];
  filters: {
    type: AssetTypeFilter;
    status: AssetStatusFilter;
    connectionId: string;
  };
}

export function renderCreatives(data: CreativesData): string {
  const accountName = (id: string): string => {
    const c = data.connections.find((x) => x.id === id);
    return c ? c.accountName : id.slice(0, 8);
  };

  const body = html`
    <h1>Creative library</h1>
    <p class="muted">All generated and edited image / video assets across accounts.</p>

    <div class="grid grid-3">
      ${countCard('Successful', data.counts.byStatus.success ?? 0)}
      ${countCard(
        'In progress',
        (data.counts.byStatus.processing ?? 0) +
          (data.counts.byStatus.pending ?? 0),
      )}
      ${countCard('Failed', data.counts.byStatus.failed ?? 0)}
    </div>

    <div class="card" style="margin-top:1.5rem">
      <form method="GET" action="/creatives" class="inline">
        <label>Type
          <select name="type">
            ${typeOption('all', data.filters.type, 'All types')}
            ${typeOption('image', data.filters.type, 'Image')}
            ${typeOption('video', data.filters.type, 'Video')}
          </select>
        </label>
        <label>Status
          <select name="status">
            ${statusOption('all', data.filters.status, 'All statuses')}
            ${statusOption('success', data.filters.status, 'Success')}
            ${statusOption('failed', data.filters.status, 'Failed')}
            ${statusOption('in_progress', data.filters.status, 'In progress')}
            ${statusOption('expired', data.filters.status, 'Expired')}
          </select>
        </label>
        <label>Account
          <select name="connectionId">
            <option value=""${data.filters.connectionId === '' ? safe(' selected') : safe('')}>All accounts</option>
            ${data.connections.map(
              (c) => html`<option value="${c.id}"${data.filters.connectionId === c.id ? safe(' selected') : safe('')}>${c.accountName}</option>`,
            )}
          </select>
        </label>
        <button type="submit">Apply</button>
        <a class="btn subtle" href="/creatives">Reset</a>
      </form>
    </div>

    <div style="margin-top:1.5rem">
      ${data.assets.rows.length === 0
        ? html`<div class="card empty">No assets match the filters.</div>`
        : html`<div class="asset-grid">${data.assets.rows.map((a) => assetCard(a, accountName))}</div>`}
    </div>

    ${renderPager(data.assets, data.filters)}
  `;
  return renderPage(
    {
      title: 'Creatives',
      active: 'creatives',
      username: data.username,
      crumbs: [{ href: '/', label: 'Home' }, { label: 'Creatives' }],
    },
    body,
  );
}

function typeOption(
  value: AssetTypeFilter,
  current: AssetTypeFilter,
  label: string,
): SafeHtml {
  return html`<option value="${value}"${current === value ? safe(' selected') : safe('')}>${label}</option>`;
}

function statusOption(
  value: AssetStatusFilter,
  current: AssetStatusFilter,
  label: string,
): SafeHtml {
  return html`<option value="${value}"${current === value ? safe(' selected') : safe('')}>${label}</option>`;
}

function countCard(label: string, n: number): SafeHtml {
  return html`
    <div class="card">
      <div class="muted">${label}</div>
      <div class="stat">${n}</div>
    </div>
  `;
}

function assetCard(
  a: ContentAsset,
  accountName: (id: string) => string,
): SafeHtml {
  const urls = Array.isArray(a.resultUrls)
    ? (a.resultUrls as unknown[]).filter((u): u is string => typeof u === 'string')
    : [];
  const isVideo =
    a.assetType === 'video_generated' || a.assetType === 'video_image_to_video';
  const firstUrl = urls[0] ?? null;

  const preview = firstUrl
    ? isVideo
      ? html`<video class="thumb" src="${firstUrl}" controls preload="metadata" playsinline></video>`
      : html`<a href="${firstUrl}" target="_blank" rel="noopener"><img class="thumb" src="${firstUrl}" alt="" loading="lazy"></a>`
    : html`<div class="thumb" style="display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:0.8rem">no preview</div>`;

  const meta = (a.metadata ?? {}) as Record<string, unknown>;
  const reqParams = (a.requestParams ?? {}) as Record<string, unknown>;
  const model =
    typeof meta.model === 'string'
      ? meta.model
      : typeof reqParams.model === 'string'
        ? reqParams.model
        : null;
  const fileSize =
    typeof meta.fileSize === 'number'
      ? formatBytes(meta.fileSize)
      : typeof meta.size === 'number'
        ? formatBytes(meta.size)
        : null;

  return html`
    <div class="asset-card">
      ${preview}
      <div>${typeBadge(a.assetType)} ${statusBadge(a.status)}</div>
      <div style="font-size:0.85rem">${truncate(a.prompt ?? '(no prompt)', 110)}</div>
      <div class="meta">
        <div><strong>Account:</strong> ${accountName(a.connectionId)}</div>
        ${model ? html`<div><strong>Model:</strong> ${model}</div>` : safe('')}
        ${fileSize ? html`<div><strong>Size:</strong> ${fileSize}</div>` : safe('')}
        <div><strong>Created:</strong> ${fmtRelative(a.createdAt)}</div>
        ${a.expiresAt ? html`<div><strong>Expires:</strong> ${fmtDate(a.expiresAt)}</div>` : safe('')}
      </div>
      <div class="actions">
        ${urls.map(
          (url, i) => html`
            <a class="btn subtle" href="${url}" target="_blank" rel="noopener" download>
              Download${urls.length > 1 ? ` ${i + 1}` : ''}
            </a>
          `,
        )}
      </div>
    </div>
  `;
}

function typeBadge(t: string): SafeHtml {
  if (t === 'image_generated') return html`<span class="badge">image</span>`;
  if (t === 'image_edited') return html`<span class="badge">image edit</span>`;
  if (t === 'video_generated') return html`<span class="badge">video</span>`;
  if (t === 'video_image_to_video')
    return html`<span class="badge">img→video</span>`;
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

function renderPager(
  paged: PaginatedAssets,
  filters: { type: AssetTypeFilter; status: AssetStatusFilter; connectionId: string },
): SafeHtml {
  if (paged.totalPages <= 1) return safe('');
  const params = new URLSearchParams();
  if (filters.type !== 'all') params.set('type', filters.type);
  if (filters.status !== 'all') params.set('status', filters.status);
  if (filters.connectionId) params.set('connectionId', filters.connectionId);

  const link = (p: number): string => {
    const q = new URLSearchParams(params);
    q.set('page', String(p));
    return `/creatives?${q.toString()}`;
  };

  const prev =
    paged.page > 1
      ? html`<a href="${link(paged.page - 1)}">← Prev</a>`
      : html`<span class="disabled">← Prev</span>`;
  const next =
    paged.page < paged.totalPages
      ? html`<a href="${link(paged.page + 1)}">Next →</a>`
      : html`<span class="disabled">Next →</span>`;

  return html`
    <div class="pager">
      ${prev}
      <span class="info">Page ${paged.page} of ${paged.totalPages} · ${paged.total} total</span>
      ${next}
    </div>
  `;
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
