import { html, safe } from '../html.js';
import { renderLoginShell } from '../layout.js';

export function renderLogin(opts: { error?: string | undefined }): string {
  const alert = opts.error
    ? html`<div class="alert error">${opts.error}</div>`
    : safe('');
  const body = html`
    <div class="card">
      <h1 style="margin-top:0">Sign in</h1>
      <p class="muted">Internal access only.</p>
      ${alert}
      <form method="POST" action="/login" class="stack">
        <label>
          Username
          <input type="text" name="username" autocomplete="username" required>
        </label>
        <label>
          Password
          <input type="password" name="password" autocomplete="current-password" required>
        </label>
        <button type="submit">Sign in</button>
      </form>
    </div>
  `;
  return renderLoginShell(body);
}

export function renderDashboardOffline(): string {
  const body = html`
    <div class="card">
      <h1 style="margin-top:0">Dashboard not available</h1>
      <p>The dashboard has not been configured. Ask your administrator to set the required credentials.</p>
    </div>
  `;
  return renderLoginShell(body);
}
