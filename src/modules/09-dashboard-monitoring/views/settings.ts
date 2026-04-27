import { fmtRelative, html, maskSecret, safe, type SafeHtml } from '../html.js';
import { renderPage } from '../layout.js';
import type { MetaConnection } from '../../../db/schema/meta-connections.js';
import type { KieCredential } from '../../../db/schema/kie-credentials.js';

interface SettingsData {
  username: string;
  metaConnections: MetaConnection[];
  kieCredentials: KieCredential[];
  flash?: { kind: 'success' | 'error'; message: string } | null | undefined;
}

export function renderSettings(data: SettingsData): string {
  const flash = data.flash
    ? html`<div class="alert ${safe(data.flash.kind)}">${data.flash.message}</div>`
    : safe('');

  const body = html`
    <h1>Settings</h1>
    ${flash}

    <h2>Ad accounts</h2>
    <div class="grid grid-2">
      <div class="card">
        <h3>Connected accounts</h3>
        ${data.metaConnections.length === 0
          ? html`<div class="empty">None yet.</div>`
          : connectionsList(data.metaConnections)}
      </div>
      <div class="card">
        <h3>Add an ad account</h3>
        <form method="POST" action="/settings/meta" class="stack">
          <label>
            Display name
            <input type="text" name="accountName" required>
          </label>
          <label>
            Ad account ID (numeric, without "act_" prefix)
            <input type="text" name="adAccountId" required pattern="[0-9]+">
          </label>
          <label>
            Access token
            <input type="password" name="accessToken" required>
          </label>
          <button type="submit">Add account</button>
        </form>
      </div>
    </div>

    <h2 style="margin-top:2rem">Image provider</h2>
    <div class="grid grid-2">
      <div class="card">
        <h3>Configured keys</h3>
        ${data.kieCredentials.length === 0
          ? html`<div class="empty">None yet.</div>`
          : kieList(data.kieCredentials)}
      </div>
      <div class="card">
        <h3>Add a key</h3>
        <form method="POST" action="/settings/kie" class="stack">
          <label>
            Label
            <input type="text" name="label" required>
          </label>
          <label>
            API key
            <input type="password" name="apiKey" required>
          </label>
          <button type="submit">Add key</button>
        </form>
      </div>
    </div>
  `;
  return renderPage(
    { title: 'Settings', active: 'settings', username: data.username },
    body,
  );
}

function connectionsList(rows: MetaConnection[]): SafeHtml {
  return html`
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Account</th><th>Status</th><th>Validated</th><th>Edit name</th><th>Replace token</th></tr>
        </thead>
        <tbody>
          ${rows.map(
            (r) => html`
              <tr>
                <td>
                  <strong>${r.accountName}</strong>
                  <div class="muted">act_${r.adAccountId}</div>
                  <div class="muted">${maskSecret(r.accessToken)}</div>
                </td>
                <td>${statusBadge(r.status)}</td>
                <td class="muted">${fmtRelative(r.lastValidatedAt)}</td>
                <td>
                  <form method="POST" action="/settings/meta/rename" class="stack" style="gap:0.4rem">
                    <input type="hidden" name="connectionId" value="${r.id}">
                    <input type="text" name="accountName" value="${r.accountName}" required maxlength="200">
                    <button type="submit" class="subtle">Save name</button>
                  </form>
                </td>
                <td>
                  <form method="POST" action="/settings/meta/replace" class="stack" style="gap:0.4rem">
                    <input type="hidden" name="connectionId" value="${r.id}">
                    <input type="password" name="accessToken" placeholder="New token" required>
                    <button type="submit" class="subtle">Replace</button>
                  </form>
                </td>
              </tr>
            `,
          )}
        </tbody>
      </table>
    </div>
  `;
}

function kieList(rows: KieCredential[]): SafeHtml {
  return html`
    <div class="table-wrap">
      <table>
        <thead><tr><th>Label</th><th>Status</th><th>Validated</th><th>Replace key</th></tr></thead>
        <tbody>
          ${rows.map(
            (r) => html`
              <tr>
                <td>
                  <strong>${r.label}</strong>
                  <div class="muted">${maskSecret(r.apiKey)}</div>
                </td>
                <td>${statusBadge(r.status)}</td>
                <td class="muted">${fmtRelative(r.lastValidatedAt)}</td>
                <td>
                  <form method="POST" action="/settings/kie/replace" class="stack" style="gap:0.4rem">
                    <input type="hidden" name="credentialId" value="${r.id}">
                    <input type="password" name="apiKey" placeholder="New key" required>
                    <button type="submit" class="subtle">Replace</button>
                  </form>
                </td>
              </tr>
            `,
          )}
        </tbody>
      </table>
    </div>
  `;
}

function statusBadge(s: string): SafeHtml {
  if (s === 'active') return html`<span class="badge good">active</span>`;
  if (s === 'invalid' || s === 'credits_exhausted')
    return html`<span class="badge bad">${s.replace(/_/g, ' ')}</span>`;
  if (s === 'expired' || s === 'revoked')
    return html`<span class="badge warn">${s}</span>`;
  return html`<span class="badge">${s}</span>`;
}
