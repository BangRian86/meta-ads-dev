import { eq } from 'drizzle-orm';
import { syncAccount } from '../src/modules/01-manage-campaigns/index.js';
import { runOptimizer } from '../src/modules/11-auto-optimizer/index.js';
import { escapeMd, notifyOwner } from '../src/modules/10-telegram-bot/index.js';
import { closeDb, db } from '../src/modules/00-foundation/index.js';
import { metaConnections } from '../src/db/schema/index.js';
import { logger } from '../src/modules/00-foundation/index.js';
import { TokenInvalidError } from '../src/modules/00-foundation/index.js';

interface RunRecord {
  connectionId: string;
  label: string;
  syncOk: boolean;
  syncError?: string;
  syncCounts?: { campaigns: number; adSets: number; ads: number };
  optimizerSummary?: {
    evaluated: number;
    decisions: number;
    executed: number;
    notifiedOnly: number;
    skipped: number;
    failed: number;
  };
  optimizerError?: string;
  abort?: 'token_invalid';
}

async function main(): Promise<number> {
  const argId = process.argv[2];

  const conns = argId
    ? await db.select().from(metaConnections).where(eq(metaConnections.id, argId))
    : await db
        .select()
        .from(metaConnections)
        .where(eq(metaConnections.status, 'active'));

  if (conns.length === 0) {
    logger.warn('No active connections; nothing to do');
    console.log(JSON.stringify({ scanned: 0, records: [] }));
    return 0;
  }

  const records: RunRecord[] = [];
  let aborted = false;

  for (const conn of conns) {
    const rec: RunRecord = {
      connectionId: conn.id,
      label: conn.accountName,
      syncOk: false,
    };

    // Step 1: Sync. If sync fails, skip optimizer for this connection (stale data).
    try {
      const r = await syncAccount(conn.id);
      rec.syncOk = true;
      rec.syncCounts = {
        campaigns: r.campaignCount,
        adSets: r.adSetCount,
        ads: r.adCount,
      };
      logger.info({ connectionId: conn.id, ...rec.syncCounts }, 'Sync OK');
    } catch (err) {
      rec.syncError = err instanceof Error ? err.message : String(err);
      logger.error({ err, connectionId: conn.id }, 'Sync failed');
      if (err instanceof TokenInvalidError) {
        rec.abort = 'token_invalid';
        records.push(rec);
        aborted = true;
        break;
      }
      records.push(rec);
      continue;
    }

    // Step 2: Optimize.
    try {
      const r = await runOptimizer({ connectionId: conn.id });
      rec.optimizerSummary = {
        evaluated: r.evaluated,
        decisions: r.decisions,
        executed: r.executed,
        notifiedOnly: r.notifiedOnly,
        skipped: r.skipped,
        failed: r.failed,
      };
      logger.info(
        { connectionId: conn.id, ...rec.optimizerSummary },
        'Optimizer OK',
      );
    } catch (err) {
      rec.optimizerError = err instanceof Error ? err.message : String(err);
      logger.error({ err, connectionId: conn.id }, 'Optimizer failed');
      if (err instanceof TokenInvalidError) {
        rec.abort = 'token_invalid';
        records.push(rec);
        aborted = true;
        break;
      }
    }

    records.push(rec);
  }

  await sendSummary(records, aborted);

  console.log(JSON.stringify({ scanned: records.length, aborted, records }, null, 2));
  const anyFail = aborted || records.some((r) => !r.syncOk || r.optimizerError);
  return anyFail ? 1 : 0;
}

async function sendSummary(records: RunRecord[], aborted: boolean): Promise<void> {
  if (records.length === 0) return;

  const headline = aborted ? '🛑 *Hourly run aborted*' : '🔁 *Hourly run summary*';
  const lines: string[] = [headline, ''];

  for (const r of records) {
    lines.push(`*${escapeMd(r.label)}*`);

    if (r.syncOk && r.syncCounts) {
      lines.push(
        `  sync ✅ ${r.syncCounts.campaigns} campaigns / ${r.syncCounts.adSets} ad sets / ${r.syncCounts.ads} ads`,
      );
    } else {
      lines.push(`  sync ❌ ${escapeMd(truncate(r.syncError ?? 'failed', 200))}`);
    }

    if (r.optimizerSummary) {
      const s = r.optimizerSummary;
      lines.push(
        `  optimizer: ${s.evaluated} active, ${s.decisions} decisions ` +
          `(${s.executed} executed, ${s.notifiedOnly} notified, ${s.skipped} skipped, ${s.failed} failed)`,
      );
    } else if (r.optimizerError) {
      lines.push(`  optimizer ❌ ${escapeMd(truncate(r.optimizerError, 200))}`);
    } else if (r.syncOk) {
      lines.push(`  optimizer: skipped`);
    }

    if (r.abort === 'token_invalid') {
      lines.push(`  ⚠️ Aborted: token invalid — owner must replace.`);
    }
    lines.push('');
  }

  const result = await notifyOwner(lines.join('\n'));
  if (!result.delivered) {
    logger.warn({ reason: result.reason }, 'Run summary not delivered to Telegram');
  }
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}

let exitCode = 0;
try {
  exitCode = await main();
} catch (err) {
  logger.fatal({ err }, 'Optimizer runner crashed');
  exitCode = 1;
} finally {
  await closeDb();
}
process.exit(exitCode);
