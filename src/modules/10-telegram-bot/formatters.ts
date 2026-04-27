// Plain-text formatters. No Markdown / HTML / backticks — Telegram messages
// are sent without parse_mode, so any content (including ad copy with
// punctuation, underscores in field names, etc.) renders as-is without
// tripping the entity parser.

export function fmtIdr(amount: number): string {
  if (!Number.isFinite(amount)) return '—';
  return 'Rp ' + Math.round(amount).toLocaleString('id-ID');
}

export function fmtPct(pct: number, digits = 2): string {
  if (!Number.isFinite(pct)) return '—';
  return `${pct.toFixed(digits)}%`;
}

export function trim(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}

export interface CampaignReportRow {
  id: string;
  name: string;
  status: string;
  effectiveStatus: string;
  spendIdr: number;
  results: number;
  cprIdr: number;
  ctrPct: number;
  /** Account label shown when ranking spans multiple connections. */
  account?: string;
}

export function renderStatusBlock(rows: CampaignReportRow[]): string {
  if (rows.length === 0) return '(no active campaigns)';
  const lines: string[] = [];
  for (const r of rows) {
    lines.push(
      `• ${trim(r.name, 60)}\n` +
        `  id: ${r.id}\n` +
        `  status: ${r.status} / ${r.effectiveStatus}\n` +
        `  spend: ${fmtIdr(r.spendIdr)}  |  results: ${r.results}  |  cpr: ${fmtIdr(r.cprIdr)}`,
    );
  }
  return lines.join('\n\n');
}

export function renderRankingBlock(
  title: string,
  rows: CampaignReportRow[],
): string {
  if (rows.length === 0) return `${title}\n(no eligible campaigns)`;
  const lines = rows.map((r, i) => {
    const acct = r.account ? `   Akun: ${r.account}\n` : '';
    return (
      `${i + 1}. ${trim(r.name, 60)}\n` +
      acct +
      `   spend: ${fmtIdr(r.spendIdr)} | cpr: ${fmtIdr(r.cprIdr)} | ctr: ${fmtPct(r.ctrPct)}`
    );
  });
  return `${title}\n\n${lines.join('\n\n')}`;
}

export function renderReportBlock(
  rows: CampaignReportRow[],
  totals: { spend: number; results: number; cprAvg: number },
): string {
  if (rows.length === 0) return '(no data in the report window)';
  const lines = rows.map(
    (r) =>
      `• ${trim(r.name, 50)}\n` +
      `  spend: ${fmtIdr(r.spendIdr)}  cpr: ${fmtIdr(r.cprIdr)}  ctr: ${fmtPct(r.ctrPct)}  results: ${r.results}`,
  );
  return (
    `Total — spend ${fmtIdr(totals.spend)} | results ${totals.results} | avg CPR ${fmtIdr(totals.cprAvg)}\n\n` +
    lines.join('\n\n')
  );
}
