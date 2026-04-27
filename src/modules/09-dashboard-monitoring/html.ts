/**
 * Tiny HTML templating helpers. Tagged template `html` auto-escapes
 * interpolated values; wrap pre-rendered fragments in `safe()` to opt out.
 */

export class SafeHtml {
  constructor(public readonly raw: string) {}
}

export function safe(s: string): SafeHtml {
  return new SafeHtml(s);
}

export function escape(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function html(strings: TemplateStringsArray, ...values: unknown[]): SafeHtml {
  let out = strings[0] ?? '';
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v instanceof SafeHtml) {
      out += v.raw;
    } else if (Array.isArray(v)) {
      out += v
        .map((item) => (item instanceof SafeHtml ? item.raw : escape(item)))
        .join('');
    } else {
      out += escape(v);
    }
    out += strings[i + 1] ?? '';
  }
  return new SafeHtml(out);
}

export function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return '—';
  const pad = (n: number) => n.toString().padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    ` ${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

export function fmtRelative(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return '—';
  const diffMs = Date.now() - date.getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}

export function maskSecret(secret: string | null | undefined, visibleTail = 4): string {
  if (!secret) return '—';
  if (secret.length <= visibleTail) return '•'.repeat(secret.length);
  return `${'•'.repeat(Math.min(8, secret.length - visibleTail))}${secret.slice(-visibleTail)}`;
}
