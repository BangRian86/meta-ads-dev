import type { ClosingSource, RoasReport } from './service.js';

function fmtIdr(n: number): string {
  return `Rp ${Math.round(n).toLocaleString('id-ID')}`;
}

function fmtRoas(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '—';
  return `${n.toFixed(2)}x`;
}

function sourceTag(s: ClosingSource): string {
  if (s === 'sheets') return '';
  if (s === 'manual') return ' (manual)';
  return ' (no data)';
}

export function formatRoasReport(r: RoasReport): string {
  const lines: string[] = [];
  lines.push(`ROAS REPORT - ${r.rangeLabel}`);
  lines.push('');

  for (const a of r.perAccount) {
    lines.push(a.accountName.toUpperCase());
    lines.push(`Ad Spend  : ${fmtIdr(a.spendIdr)}`);
    lines.push(`Revenue   : ${fmtIdr(a.revenueIdr)}${sourceTag(a.closingSource)}`);
    lines.push(`Closing   : ${a.closingQuantity} ${a.unit}`);
    lines.push(`ROAS      : ${fmtRoas(a.roas)}`);
    if (a.closingNote) lines.push(`Note      : ${a.closingNote}`);
    lines.push('');
  }

  lines.push('TOTAL');
  lines.push(`Ad Spend  : ${fmtIdr(r.totalSpendIdr)}`);
  lines.push(`Revenue   : ${fmtIdr(r.totalRevenueIdr)}`);
  lines.push(`ROAS      : ${fmtRoas(r.totalRoas)}`);

  return lines.join('\n');
}
