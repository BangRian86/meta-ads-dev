import { Telegraf } from 'telegraf';
import { and, eq, gte, lte } from 'drizzle-orm';
import { closeDb, db } from '../src/db/index.js';
import { config } from '../src/config/env.js';
import { logger } from '../src/lib/logger.js';
import { metaConnections } from '../src/db/schema/meta-connections.js';
import { metaObjectSnapshots } from '../src/db/schema/meta-object-snapshots.js';
import { operationAudits } from '../src/db/schema/operation-audits.js';
import {
  analyze,
  type DateRange,
  type Target,
} from '../src/modules/02-ads-analysis/index.js';
import { buildRoasReport } from '../src/modules/15-closing-tracker/index.js';

interface CampaignRow {
  campaignId: string;
  campaignName: string;
  accountName: string;
  spend: number;
  results: number;
  cpr: number;
}

function fmtIdr(n: number): string {
  return `Rp ${Math.round(n).toLocaleString('id-ID')}`;
}

function isoDateOffset(daysFromToday: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromToday);
  return d.toISOString().slice(0, 10);
}

async function listActiveCampaignSnapshots(connectionId: string) {
  const rows = await db
    .select()
    .from(metaObjectSnapshots)
    .where(
      and(
        eq(metaObjectSnapshots.connectionId, connectionId),
        eq(metaObjectSnapshots.objectType, 'campaign'),
      ),
    );
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const cur = latest.get(r.objectId);
    if (!cur || r.fetchedAt.getTime() > cur.fetchedAt.getTime()) {
      latest.set(r.objectId, r);
    }
  }
  return [...latest.values()].filter((r) => r.status === 'ACTIVE');
}

/**
 * Reads anomaly alerts from operation_audits. Anomaly alerts are not yet
 * persisted there (they go to Telegram + alert_dedupe), so for now we
 * approximate with copy.fix.failed + budget rejections that surfaced
 * yesterday. Once anomalies are mirrored into operation_audits this query
 * can be tightened.
 */
async function listYesterdayAnomalies(): Promise<string[]> {
  const start = new Date(`${isoDateOffset(-1)}T00:00:00Z`);
  const end = new Date(`${isoDateOffset(0)}T00:00:00Z`);
  const rows = await db
    .select({
      operationType: operationAudits.operationType,
      errorMessage: operationAudits.errorMessage,
      createdAt: operationAudits.createdAt,
    })
    .from(operationAudits)
    .where(
      and(
        eq(operationAudits.status, 'failed'),
        gte(operationAudits.createdAt, start),
        lte(operationAudits.createdAt, end),
      ),
    );
  // Deduplicate by operationType + first 80 chars of error.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) {
    const tag = r.operationType;
    const head = (r.errorMessage ?? '').slice(0, 80).replace(/\s+/g, ' ');
    const key = `${tag}::${head}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(`• ${tag}: ${head}`);
    if (out.length >= 8) break;
  }
  return out;
}

async function buildSummary(): Promise<string> {
  const yday = isoDateOffset(-1);
  const range: DateRange = { since: yday, until: yday };

  const conns = await db
    .select()
    .from(metaConnections)
    .where(eq(metaConnections.status, 'active'));

  let totalSpend = 0;
  let totalResults = 0;
  const allCampaignRows: CampaignRow[] = [];

  for (const conn of conns) {
    const campaigns = await listActiveCampaignSnapshots(conn.id);
    if (campaigns.length === 0) continue;
    const targets: Target[] = campaigns.map((c) => ({
      type: 'campaign',
      id: c.objectId,
    }));
    try {
      const r = await analyze({ connectionId: conn.id, targets, range });
      totalSpend += r.rollup.spend;
      totalResults += r.rollup.results;
      for (const t of r.perTarget) {
        const snap = campaigns.find((c) => c.objectId === t.target.id);
        if (!snap) continue;
        allCampaignRows.push({
          campaignId: t.target.id,
          campaignName: snap.name,
          accountName: conn.accountName,
          spend: t.summary.spend,
          results: t.summary.results,
          cpr: t.summary.cpr,
        });
      }
    } catch (err) {
      logger.warn(
        { err, connectionId: conn.id },
        'Daily summary: per-account analyze failed',
      );
    }
  }

  // Best = lowest positive CPR with at least 1 result.
  const eligible = allCampaignRows.filter((r) => r.results > 0 && r.cpr > 0);
  const best = [...eligible].sort((a, b) => a.cpr - b.cpr)[0] ?? null;
  // Worst = highest CPR among campaigns that spent something.
  const spent = allCampaignRows.filter((r) => r.spend > 0);
  const worst =
    [...spent].sort((a, b) => {
      const av = a.results === 0 ? Number.MAX_SAFE_INTEGER : a.cpr;
      const bv = b.results === 0 ? Number.MAX_SAFE_INTEGER : b.cpr;
      return bv - av;
    })[0] ?? null;

  const anomalies = await listYesterdayAnomalies();
  const avgCpr = totalResults > 0 ? totalSpend / totalResults : 0;

  // ROAS for yesterday — pulled from Google Sheets via closing-tracker.
  // Best-effort: if it crashes (sheets API down), surface "—" rather than
  // failing the whole summary.
  let roasLines: string[] = [];
  try {
    const r = await buildRoasReport(1, 1);
    roasLines = ['ROAS KEMARIN'];
    for (const a of r.perAccount) {
      const roasStr = a.roas > 0 ? `${a.roas.toFixed(2)}x` : '—';
      const note = a.closingSource === 'sheets' ? '' : ` (${a.closingSource})`;
      roasLines.push(
        `• ${a.accountName}: ${roasStr} — spend ${fmtIdr(a.spendIdr)} / rev ${fmtIdr(a.revenueIdr)} / ${a.closingQuantity} ${a.unit}${note}`,
      );
    }
    const totalRoasStr = r.totalRoas > 0 ? `${r.totalRoas.toFixed(2)}x` : '—';
    roasLines.push(
      `Total: ${totalRoasStr} (rev ${fmtIdr(r.totalRevenueIdr)} / spend ${fmtIdr(r.totalSpendIdr)})`,
    );
  } catch (err) {
    logger.warn({ err }, 'Daily summary: ROAS section failed');
    roasLines = ['ROAS KEMARIN', '(gagal baca data)'];
  }

  const lines: string[] = [];
  lines.push('GOOD MORNING! SUMMARY KEMARIN 📊');
  lines.push(yday);
  lines.push('');
  lines.push('TOTAL SEMUA AKUN');
  lines.push(`Ad Spend  : ${fmtIdr(totalSpend)}`);
  lines.push(`Results   : ${totalResults}`);
  lines.push(`CPR avg   : ${fmtIdr(avgCpr)}`);
  lines.push('');
  lines.push('TERBAIK KEMARIN ✅');
  if (best) {
    lines.push(`${best.campaignName} (${best.accountName})`);
    lines.push(`CPR: ${fmtIdr(best.cpr)} | Results: ${best.results}`);
  } else {
    lines.push('Belum ada campaign dengan results kemarin.');
  }
  lines.push('');
  lines.push('TERBURUK KEMARIN ⚠️');
  if (worst) {
    lines.push(`${worst.campaignName} (${worst.accountName})`);
    lines.push(`CPR: ${worst.results === 0 ? '— (no result)' : fmtIdr(worst.cpr)} | Results: ${worst.results}`);
  } else {
    lines.push('Tidak ada campaign yang spend kemarin.');
  }
  lines.push('');
  for (const l of roasLines) lines.push(l);
  lines.push('');
  lines.push('ANOMALI KEMARIN');
  if (anomalies.length === 0) {
    lines.push('Tidak ada anomali');
  } else {
    for (const a of anomalies) lines.push(a);
  }
  lines.push('');
  lines.push('AGENDA HARI INI');
  lines.push('- Optimizer jalan jam 09.00, 12.00, 15.00, 18.00, 21.00');
  lines.push('- Laporan progress: 11.00, 16.00, 21.00 WIB');
  lines.push('- Laporan Sheets: 09.00 WIB');

  return lines.join('\n');
}

async function main(): Promise<number> {
  if (!config.telegram.botToken) {
    logger.error('No TELEGRAM_BOT_TOKEN — cannot send daily summary');
    return 2;
  }
  const groupId = config.telegram.groupChatId;
  if (!groupId) {
    logger.error('No TELEGRAM_GROUP_CHAT_ID — cannot send daily summary');
    return 2;
  }

  const sender = new Telegraf(config.telegram.botToken);

  let messageText: string;
  try {
    messageText = await buildSummary();
    logger.info({ chars: messageText.length }, 'daily-summary: built');
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.error({ err }, 'daily-summary: build crashed');
    messageText = `❌ Daily summary gagal dibuat.\nError: ${reason}`;
  }

  try {
    await sender.telegram.sendMessage(groupId, messageText, {
      link_preview_options: { is_disabled: true },
    });
    logger.info({ groupId }, 'daily-summary: sent');
    return 0;
  } catch (err) {
    logger.error({ err, groupId }, 'daily-summary: failed to send');
    return 3;
  }
}

let exitCode = 0;
try {
  exitCode = await main();
} catch (err) {
  logger.fatal({ err }, 'daily-summary: unexpected crash');
  exitCode = 1;
} finally {
  await closeDb();
}
process.exit(exitCode);
