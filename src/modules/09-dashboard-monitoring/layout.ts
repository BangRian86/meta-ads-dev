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
  .nav-toggle {
    display: none;
    background: var(--soft); color: var(--text);
    border: 1px solid var(--border);
    border-radius: 6px;
    width: 40px; height: 40px;
    align-items: center; justify-content: center;
    cursor: pointer; padding: 0;
    font-size: 1.25rem;
  }
  .nav-toggle:hover { background: var(--border); }
  main {
    max-width: 1200px;
    margin: 0 auto;
    padding: 1.5rem 1.25rem;
  }
  h1 { font-size: 1.5rem; margin: 0 0 1rem; }
  h2 { font-size: 1.15rem; margin: 1.5rem 0 0.75rem; }
  h3 { font-size: 1rem; margin: 1rem 0 0.5rem; }
  .grid { display: grid; gap: 1rem; }
  .grid-2 { grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
  .grid-3 { grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
  .grid-4 { grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); }
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
  table { width: 100%; border-collapse: collapse; min-width: 540px; }
  th, td {
    text-align: left; padding: 0.6rem 0.75rem;
    border-bottom: 1px solid var(--border); vertical-align: top;
  }
  th { font-size: 0.78rem; text-transform: uppercase; color: var(--muted); letter-spacing: 0.04em; }
  tr:last-child td { border-bottom: none; }
  .table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
  form.stack { display: grid; gap: 0.75rem; max-width: 520px; }
  form.stack label { display: grid; gap: 0.25rem; font-size: 0.875rem; color: var(--muted); }
  form.inline { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: end; }
  form.inline label { display: grid; gap: 0.2rem; font-size: 0.8rem; color: var(--muted); flex: 1; min-width: 140px; }
  form.inline button { white-space: nowrap; }
  input[type="text"], input[type="password"], input[type="email"], input[type="url"], input[type="search"], textarea, select {
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
  button.subtle, .btn.subtle {
    background: var(--soft); color: var(--text);
  }
  button.subtle:hover, .btn.subtle:hover { background: var(--border); }
  .empty { padding: 2rem 1rem; text-align: center; color: var(--muted); }
  .crumbs {
    font-size: 0.875rem; color: var(--muted); margin-bottom: 1rem;
    display: flex; flex-wrap: wrap; gap: 0.4rem; align-items: center;
  }
  .crumbs a { color: var(--muted); }
  .crumbs span.sep { color: var(--border); }
  .crumbs span.current { color: var(--text); font-weight: 500; }
  .pill-row { display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; }
  .alert { padding: 0.75rem 1rem; border-radius: 8px; margin-bottom: 1rem; font-size: 0.9rem; }
  .alert.success { background: #e6f4ea; color: var(--good); border: 1px solid #b7dec0; }
  .alert.error { background: #fce8e6; color: var(--bad); border: 1px solid #f3c2bf; }
  .login-shell { max-width: 380px; margin: 4rem auto; }
  .login-shell .card { padding: 1.5rem; }
  .pager {
    display: flex; gap: 0.5rem; justify-content: center; align-items: center;
    margin-top: 1rem; flex-wrap: wrap;
  }
  .pager .info { color: var(--muted); font-size: 0.85rem; }
  .pager a, .pager span.disabled {
    padding: 0.4rem 0.75rem; border-radius: 6px;
    background: var(--soft); color: var(--text);
    text-decoration: none; font-weight: 500; font-size: 0.85rem;
  }
  .pager span.disabled { color: var(--muted); cursor: not-allowed; opacity: 0.6; }
  .pager a:hover { background: var(--border); text-decoration: none; }
  .thumb {
    width: 100%; max-width: 200px; aspect-ratio: 1;
    object-fit: cover; border-radius: 6px;
    background: var(--soft); border: 1px solid var(--border);
    display: block;
  }
  video.thumb { object-fit: contain; background: #000; }
  .asset-grid {
    display: grid; gap: 1rem;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  }
  .asset-card {
    background: var(--card); border: 1px solid var(--border);
    border-radius: 10px; padding: 0.75rem; display: flex; flex-direction: column; gap: 0.5rem;
  }
  .asset-card .meta { font-size: 0.78rem; color: var(--muted); }
  .asset-card .actions { display: flex; gap: 0.4rem; flex-wrap: wrap; }
  .workflow-flow {
    display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: stretch;
    padding: 1rem; background: var(--soft); border-radius: 10px;
  }
  .workflow-step {
    flex: 1 1 160px; min-width: 140px;
    background: var(--card); border: 1px solid var(--border);
    border-radius: 8px; padding: 0.75rem;
    display: flex; flex-direction: column; gap: 0.35rem;
    position: relative;
  }
  .workflow-step .label { font-weight: 600; font-size: 0.95rem; }
  .workflow-step .desc { color: var(--muted); font-size: 0.8rem; line-height: 1.3; }
  .workflow-arrow {
    align-self: center; color: var(--muted); font-size: 1.5rem;
    flex: 0 0 auto;
  }
  @media (max-width: 720px) {
    .nav-toggle { display: inline-flex; order: 2; margin-left: auto; }
    header.topbar { gap: 0.6rem; padding: 0.6rem 0.85rem; }
    header.topbar nav {
      order: 4; flex: 1 0 100%;
      flex-direction: column; gap: 0.15rem;
      max-height: 0; overflow: hidden;
      transition: max-height 0.2s ease;
    }
    header.topbar.nav-open nav { max-height: 500px; }
    header.topbar nav a { padding: 0.55rem 0.75rem; }
    header.topbar form { order: 3; }
    header.topbar form button { font-size: 0.8rem; padding: 0.4rem 0.7rem; }
    .workflow-arrow { transform: rotate(90deg); align-self: center; }
    .workflow-step { flex: 1 0 100%; }
  }
  @media (max-width: 540px) {
    main { padding: 1rem 0.75rem; }
    .stat { font-size: 1.25rem; }
    h1 { font-size: 1.3rem; }
    h2 { font-size: 1.05rem; }
    body { font-size: 14.5px; }
  }
`;

const NAV_TOGGLE_SCRIPT = `
  (function () {
    var btn = document.getElementById('nav-toggle');
    var bar = document.getElementById('topbar');
    if (!btn || !bar) return;
    btn.addEventListener('click', function () {
      bar.classList.toggle('nav-open');
      var open = bar.classList.contains('nav-open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  })();
`;

export type NavKey =
  | 'home'
  | 'campaigns'
  | 'creatives'
  | 'audiences'
  | 'workflows'
  | 'settings';

export interface Crumb {
  href?: string;
  label: string;
}

export interface LayoutOptions {
  title: string;
  active?: NavKey;
  username?: string | undefined;
  crumbs?: Crumb[];
}

export function renderPage(opts: LayoutOptions, body: SafeHtml): string {
  const navItems: Array<{ key: NavKey; href: string; label: string }> = [
    { key: 'home', href: '/', label: 'Home' },
    { key: 'campaigns', href: '/campaigns', label: 'Campaigns' },
    { key: 'creatives', href: '/creatives', label: 'Creatives' },
    { key: 'audiences', href: '/audiences', label: 'Audiences' },
    { key: 'workflows', href: '/workflows', label: 'Workflows' },
    { key: 'settings', href: '/settings', label: 'Settings' },
  ];
  const nav = navItems.map(
    (item) =>
      html`<a href="${item.href}"${opts.active === item.key ? safe(' class="active"') : safe('')}>${item.label}</a>`,
  );
  const userBadge = opts.username
    ? html`<form method="POST" action="/logout"><button class="subtle" type="submit">Sign out (${opts.username})</button></form>`
    : safe('');

  const crumbsHtml = renderCrumbs(opts.crumbs);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeTitle(opts.title)} — Meta Ads Console</title>
  <style>${STYLES}</style>
</head>
<body>
  <header class="topbar" id="topbar">
    <a href="/" class="brand">Meta Ads Console</a>
    <button type="button" id="nav-toggle" class="nav-toggle" aria-label="Toggle navigation" aria-expanded="false">☰</button>
    <nav>${nav.map((n) => n.raw).join('')}</nav>
    ${userBadge.raw}
  </header>
  <main>${crumbsHtml.raw}${body.raw}</main>
  <script>${NAV_TOGGLE_SCRIPT}</script>
</body>
</html>`;
}

function renderCrumbs(crumbs: Crumb[] | undefined): SafeHtml {
  if (!crumbs || crumbs.length === 0) return safe('');
  const parts: SafeHtml[] = [];
  crumbs.forEach((c, i) => {
    const isLast = i === crumbs.length - 1;
    if (c.href && !isLast) {
      parts.push(html`<a href="${c.href}">${c.label}</a>`);
    } else {
      parts.push(html`<span class="current">${c.label}</span>`);
    }
    if (!isLast) parts.push(safe('<span class="sep">/</span>'));
  });
  return html`<div class="crumbs">${parts}</div>`;
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
