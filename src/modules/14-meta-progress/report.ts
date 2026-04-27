import {
  buildProgressData,
  type AccountProgress,
  type CampaignProgressRow,
  type ProgressReport,
} from './data.js';
import { lookupBenchmark, statusEmoji, type Brand } from './benchmarks.js';

export { buildProgressData };
export type { AccountProgress, CampaignProgressRow, ProgressReport };

const MONTH_ID = [
  'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
  'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des',
];

function fmtIdr(n: number): string {
  return 'Rp ' + Math.round(n).toLocaleString('id-ID');
}

function emojiSlot(e: '✅' | '⚠️' | ''): string {
  return e ? ` ${e}` : '';
}

/** "2026-04-25" → "25 Apr 2026". */
function formatHumanDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  const monIdx = Number(m) - 1;
  const monLabel = MONTH_ID[monIdx] ?? m;
  return `${Number(d)} ${monLabel} ${y}`;
}

/**
 * Truncate to at most 25 chars; replace tail with "..." (literal three dots,
 * not the unicode ellipsis) per the spec.
 */
function shortName(name: string, max = 25): string {
  if (name.length <= max) return name;
  return name.slice(0, max - 3) + '...';
}

/** "Basmalah Travel" → "Basmalah"; "JABAR - Aqiqah Express" → "JABAR". */
function shortAccountLabel(accountName: string): string {
  const first = accountName.split(/\s+|-/).filter(Boolean)[0] ?? accountName;
  return first;
}

/** Pad short account labels so the colons line up under monospace fonts. */
function padAccountLabel(label: string, width: number): string {
  return label.padEnd(width, ' ');
}

// ---------- Header bubble ----------

function buildHeaderBubble(report: ProgressReport, hourLabelWib: string): string {
  const lines: string[] = [];
  lines.push(`PROGRESS IKLAN ${hourLabelWib} - ${formatHumanDate(report.date)}`);
  lines.push('');
  lines.push(`Total Spend   : ${fmtIdr(report.totalSpend)}`);
  lines.push(`Total Results : ${report.totalResults}`);
  lines.push('');
  // Width = longest short label among accounts (typically "Basmalah" = 8).
  const labels = report.accounts.map((a) => shortAccountLabel(a.connection.accountName));
  const width = labels.reduce((m, s) => Math.max(m, s.length), 0);
  for (let i = 0; i < report.accounts.length; i++) {
    const acc = report.accounts[i]!;
    const label = labels[i]!;
    lines.push(`${padAccountLabel(label, width)} : ${fmtIdr(acc.subtotalSpend)}`);
  }
  if (report.errors.length > 0) {
    lines.push('');
    lines.push('Error:');
    for (const e of report.errors) {
      lines.push(`- ${e.accountName}: ${e.message.slice(0, 200)}`);
    }
  }
  return lines.join('\n');
}

// ---------- Per-account bubble ----------

interface BucketAggregate {
  rows: CampaignProgressRow[];
  spend: number;
  results: number;
  clicks: number;
  impressions: number;
}

function aggregate(rows: CampaignProgressRow[]): BucketAggregate {
  return rows.reduce<BucketAggregate>(
    (acc, r) => {
      acc.rows.push(r);
      acc.spend += r.spend;
      acc.results += r.results;
      acc.clicks += r.clicks;
      acc.impressions += r.impressions;
      return acc;
    },
    { rows: [], spend: 0, results: 0, clicks: 0, impressions: 0 },
  );
}

/** Pick the dominant channel for a bucket so the avg-line emoji uses an
 *  appropriate threshold (operator's leads are predominantly to WA, traffic
 *  to LP, so default channel choice matches reality on tied buckets). */
function bucketBenchmark(brand: Brand, bucket: 'leads' | 'traffic' | 'awareness') {
  if (bucket === 'awareness') return lookupBenchmark(brand, 'awareness');
  if (bucket === 'traffic') return lookupBenchmark(brand, 'traffic_lp');
  return lookupBenchmark(brand, 'leads_wa');
}

function buildAccountBubble(
  acc: AccountProgress,
  date: string,
  hourLabelWib: string,
): string {
  const lines: string[] = [];
  lines.push(acc.connection.accountName.toUpperCase());

  if (acc.rows.length === 0) {
    lines.push('Tidak ada campaign aktif hari ini');
    return lines.join('\n');
  }

  lines.push(`${formatHumanDate(date)} | ${hourLabelWib}`);
  lines.push('');
  lines.push(`Spend : ${fmtIdr(acc.subtotalSpend)}`);
  lines.push('');

  const leads = aggregate(acc.rows.filter((r) => r.bucket === 'leads'));
  const traffic = aggregate(acc.rows.filter((r) => r.bucket === 'traffic'));
  const awareness = aggregate(acc.rows.filter((r) => r.bucket === 'awareness'));

  // ---------- Per-bucket summary lines ----------

  if (leads.rows.length > 0) {
    const avgCpr = leads.results > 0 ? leads.spend / leads.results : 0;
    const emoji = statusEmoji(avgCpr, bucketBenchmark(acc.brand, 'leads'));
    lines.push(`Leads  : ${leads.results} results | CPR avg ${fmtIdr(avgCpr)}${emojiSlot(emoji)}`);
  }
  if (traffic.rows.length > 0) {
    const avgCpc = traffic.clicks > 0 ? traffic.spend / traffic.clicks : 0;
    const emoji = statusEmoji(avgCpc, bucketBenchmark(acc.brand, 'traffic'));
    lines.push(`Traffic: ${traffic.clicks} klik | CPK avg ${fmtIdr(avgCpc)}${emojiSlot(emoji)}`);
  }
  if (awareness.rows.length > 0) {
    const avgCpm = awareness.impressions > 0 ? (awareness.spend / awareness.impressions) * 1000 : 0;
    const emoji = statusEmoji(avgCpm, bucketBenchmark(acc.brand, 'awareness'));
    lines.push(`Awareness: ${awareness.impressions.toLocaleString('id-ID')} impresi | CPM avg ${fmtIdr(avgCpm)}${emojiSlot(emoji)}`);
  }

  // ---------- Per-bucket campaign lists ----------

  if (leads.rows.length > 0) {
    lines.push('');
    lines.push('LEADS ke WA:');
    for (const r of leads.rows) {
      lines.push(`${shortName(r.name)} : ${fmtIdr(r.cpr)}/result${emojiSlot(r.emoji)}`);
    }
  }
  if (traffic.rows.length > 0) {
    lines.push('');
    lines.push('TRAFFIC:');
    for (const r of traffic.rows) {
      lines.push(`${shortName(r.name)} : ${fmtIdr(r.cpc)}/klik${emojiSlot(r.emoji)}`);
    }
  }
  if (awareness.rows.length > 0) {
    lines.push('');
    lines.push('AWARENESS:');
    for (const r of awareness.rows) {
      lines.push(`${shortName(r.name)} : CPM ${fmtIdr(r.cpm)}${emojiSlot(r.emoji)}`);
    }
  }

  return lines.join('\n');
}

// ---------- Bubble assembly ----------

export interface ProgressBubbles {
  header: string;
  perAccount: string[];
}

export function buildProgressBubbles(
  report: ProgressReport,
  hourLabelWib: string,
): ProgressBubbles {
  return {
    header: buildHeaderBubble(report, hourLabelWib),
    perAccount: report.accounts.map((acc) =>
      buildAccountBubble(acc, report.date, hourLabelWib),
    ),
  };
}

/** Convenience for the cron path: "11:00 WIB" given the cron-firing UTC hour. */
export function wibHourLabel(utcHour: number): string {
  const wib = (utcHour + 7) % 24;
  return `${String(wib).padStart(2, '0')}:00 WIB`;
}
