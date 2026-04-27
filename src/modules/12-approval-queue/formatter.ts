import type { PendingAction } from '../../db/schema/pending-actions.js';
import { shortId } from './store.js';
import type { ActionSummary } from './schema.js';

export function formatConfirmation(p: PendingAction): string {
  const s = p.summary as ActionSummary;
  return [
    '⏳ KONFIRMASI DIPERLUKAN',
    '',
    `Aksi    : ${s.actionLabel}`,
    `Target  : ${s.targetLabel}`,
    `Detail  : ${s.detail}`,
    `Alasan  : ${s.reason}`,
    `Akun    : ${s.accountName}`,
    '',
    `ID: ${shortId(p)}  ·  expires: ${formatExpiry(p.expiresAt)}`,
    '',
    "Ketik 'ya' untuk jalankan atau 'tidak' untuk batalkan",
  ].join('\n');
}

export const PENDING_LIST_CAP = 10;

export function formatPendingList(items: PendingAction[]): string {
  if (items.length === 0) return 'Tidak ada aksi yang menunggu approval.';
  // Cap di 10 supaya message tidak lewat Telegram 4096-char limit. Detail
  // (s.detail) bisa multi-line panjang (mis. preview copy variant), jadi
  // 10 entry × ~300 char per entry sudah dekat limit.
  const shown = items.slice(0, PENDING_LIST_CAP);
  const remaining = items.length - shown.length;
  const lines: string[] = [`📋 Pending actions (${items.length})`, ''];
  shown.forEach((p, i) => {
    const s = p.summary as ActionSummary;
    lines.push(`${i + 1}. [${shortId(p)}] ${s.actionLabel} — ${s.targetLabel}`);
    // Truncate detail per-baris supaya satu pending tidak hog seluruh msg.
    const detailTruncated =
      s.detail.length > 240 ? s.detail.slice(0, 237) + '…' : s.detail;
    lines.push(`   ${detailTruncated}`);
    lines.push(`   Akun: ${s.accountName}  ·  expires ${formatExpiry(p.expiresAt)}`);
    lines.push('');
  });
  if (remaining > 0) {
    lines.push(`(dan ${remaining} aksi lainnya — pakai /yes <id> langsung kalau tahu id-nya)`);
    lines.push('');
  }
  lines.push("Ketik /yes <id> untuk approve atau /no <id> untuk batal.");
  return lines.join('\n');
}

export function formatMultiPendingNudge(items: PendingAction[]): string {
  const lines: string[] = [
    `Ada ${items.length} aksi pending — tidak jelas yang mana.`,
    '',
  ];
  items.slice(0, 5).forEach((p) => {
    const s = p.summary as ActionSummary;
    lines.push(`• [${shortId(p)}] ${s.actionLabel} — ${s.targetLabel}`);
  });
  if (items.length > 5) lines.push(`… +${items.length - 5} lagi`);
  lines.push('');
  lines.push('Pakai /yes <id> atau /no <id>. /pending untuk daftar lengkap.');
  return lines.join('\n');
}

function formatExpiry(d: Date): string {
  const diffMs = d.getTime() - Date.now();
  if (diffMs <= 0) return 'expired';
  const hours = Math.floor(diffMs / (60 * 60 * 1000));
  const mins = Math.floor((diffMs % (60 * 60 * 1000)) / (60 * 1000));
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}
