import { html, safe, type SafeHtml } from './html.js';

const STYLES = `
  :root {
    --bg: #f6f7f9;
    --card: #ffffff;
    --text: #1a1f2c;
    --muted: #5f6776;
    --border: #e1e4ea;
    --accent: #2756d6;
    --accent-hover: #1f44ad;
    --good: #1f7d3a;
    --warn: #b15c00;
    --bad: #b3261e;
    --soft: #f0f3f8;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: var(--bg); color: var(--text);
    font-size: 15px; line-height: 1.45;
  }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
  header.topbar {
    background: var(--card);
    border-bottom: 1px solid var(--border);
    padding: 0.75rem 1.25rem;
    display: flex; gap: 1rem; align-items: center; flex-wrap: wrap;
    position: sticky; top: 0; z-index: 10;
  }
  header.topbar .brand {
    font-weight: 700; font-size: 1.05rem; color: var(--text);
    text-decoration: none; flex-shrink: 0;
  }
  header.topbar nav {
    display: flex; gap: 0.25rem; flex: 1; flex-wrap: wrap;
  }
  header.topbar nav a {
    padding: 0.4rem 0.75rem; border-radius: 6px; color: var(--muted); font-weight: 500;
  }
  header.topbar nav a:hover { background: var(--soft); text-decoration: none; }
  header.topbar nav a.active { background: var(--soft); color: var(--text); }
  header.topbar form { margin: 0; }
  main { max-width: 1200px; margin: 0 auto; padding: 1.5rem 1.25rem; }
  h1 { font-size: 1.5rem; margin: 0 0 1rem; }
  h2 { font-size: 1.15rem; margin: 1.5rem 0 0.75rem; }
  h3 { font-size: 1rem; margin: 1rem 0 0.5rem; }
  .grid { display: grid; gap: 1rem; }
  .grid-2 { grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
  .grid-3 { grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
  .card {
    background: var(--card); border: 1px solid var(--border);
    border-radius: 10px; padding: 1rem 1.25rem;
  }
  .card h2:first-child, .card h3:first-child { margin-top: 0; }
  .stat { font-size: 1.5rem; font-weight: 600; }
  .muted { color: var(--muted); font-size: 0.875rem; }
  .badge {
    display: inline-block; padding: 0.15rem 0.55rem; border-radius: 999px;
    font-size: 0.75rem; font-weight: 600; background: var(--soft); color: var(--muted);
    text-transform: uppercase; letter-spacing: 0.02em;
  }
  .badge.good { background: #e6f4ea; color: var(--good); }
  .badge.warn { background: #fdf2e0; color: var(--warn); }
  .badge.bad { background: #fce8e6; color: var(--bad); }
  table { width: 100%; border-collapse: collapse; }
  th, td {
    text-align: left; padding: 0.6rem 0.75rem;
    border-bottom: 1px solid var(--border); vertical-align: top;
  }
  th { font-size: 0.78rem; text-transform: uppercase; color: var(--muted); letter-spacing: 0.04em; }
  tr:last-child td { border-bottom: none; }
  .table-wrap { overflow-x: auto; }
  form.stack { display: grid; gap: 0.75rem; max-width: 520px; }
  form.stack label { display: grid; gap: 0.25rem; font-size: 0.875rem; color: var(--muted); }
  input[type="text"], input[type="password"], input[type="email"], input[type="url"], textarea, select {
    width: 100%;
    padding: 0.55rem 0.7rem;
    border: 1px solid var(--border); border-radius: 6px;
    font-size: 0.95rem; font-family: inherit;
    background: var(--card); color: var(--text);
  }
  input:focus, textarea:focus, select:focus { outline: 2px solid var(--accent); outline-offset: -1px; border-color: transparent; }
  button, .btn {
    display: inline-flex; align-items: center; justify-content: center;
    padding: 0.55rem 1rem; border-radius: 6px;
    background: var(--accent); color: #fff; border: none;
    font-size: 0.9rem; font-weight: 600; cursor: pointer;
    text-decoration: none; min-height: 40px;
  }
  button:hover, .btn:hover { background: var(--accent-hover); text-decoration: none; }
  button.subtle {
    background: var(--soft); color: var(--text);
  }
  button.subtle:hover { background: var(--border); }
  .empty { padding: 2rem 1rem; text-align: center; color: var(--muted); }
  .crumbs { font-size: 0.875rem; color: var(--muted); margin-bottom: 1rem; }
  .crumbs a { color: var(--muted); }
  .pill-row { display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; }
  .alert { padding: 0.75rem 1rem; border-radius: 8px; margin-bottom: 1rem; font-size: 0.9rem; }
  .alert.success { background: #e6f4ea; color: var(--good); border: 1px solid #b7dec0; }
  .alert.error { background: #fce8e6; color: var(--bad); border: 1px solid #f3c2bf; }
  .login-shell { max-width: 380px; margin: 4rem auto; }
  .login-shell .card { padding: 1.5rem; }
  @media (max-width: 540px) {
    main { padding: 1rem 0.75rem; }
    header.topbar { padding: 0.6rem 0.75rem; }
    header.topbar nav a { padding: 0.4rem 0.5rem; font-size: 0.9rem; }
    .stat { font-size: 1.25rem; }
  }
`;

export type NavKey = 'home' | 'campaigns' | 'creatives' | 'settings';

export interface LayoutOptions {
  title: string;
  active?: NavKey;
  username?: string | undefined;
}

export function renderPage(opts: LayoutOptions, body: SafeHtml): string {
  const navItems: Array<{ key: NavKey; href: string; label: string }> = [
    { key: 'home', href: '/', label: 'Home' },
    { key: 'campaigns', href: '/campaigns', label: 'Campaigns' },
    { key: 'creatives', href: '/creatives', label: 'Creatives' },
    { key: 'settings', href: '/settings', label: 'Settings' },
  ];
  const nav = navItems
    .map(
      (item) =>
        html`<a href="${item.href}"${opts.active === item.key ? safe(' class="active"') : safe('')}>${item.label}</a>`,
    );
  const userBadge = opts.username
    ? html`<form method="POST" action="/logout"><button class="subtle" type="submit">Sign out (${opts.username})</button></form>`
    : safe('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeTitle(opts.title)} — Meta Ads Console</title>
  <style>${STYLES}</style>
</head>
<body>
  <header class="topbar">
    <a href="/" class="brand">Meta Ads Console</a>
    <nav>${nav.map((n) => n.raw).join('')}</nav>
    ${userBadge.raw}
  </header>
  <main>${body.raw}</main>
</body>
</html>`;
}

export function renderLoginShell(body: SafeHtml): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sign in — Meta Ads Console</title>
  <style>${STYLES}</style>
</head>
<body>
  <main class="login-shell">${body.raw}</main>
</body>
</html>`;
}

function escapeTitle(s: string): string {
  return s.replace(/[<>&"']/g, (c) => {
    if (c === '<') return '&lt;';
    if (c === '>') return '&gt;';
    if (c === '&') return '&amp;';
    if (c === '"') return '&quot;';
    return '&#39;';
  });
}
