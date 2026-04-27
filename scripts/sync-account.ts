import { eq } from 'drizzle-orm';
import { syncAccount } from '../src/modules/01-manage-campaigns/index.js';
import { closeDb, db } from '../src/db/index.js';
import { metaConnections } from '../src/db/schema/index.js';
import { logger } from '../src/lib/logger.js';

interface RunResult {
  connectionId: string;
  label: string;
  ok: boolean;
  campaigns?: number;
  adSets?: number;
  ads?: number;
  error?: string;
}

async function syncOne(connectionId: string, label: string): Promise<RunResult> {
  try {
    const r = await syncAccount(connectionId);
    logger.info(
      { connectionId, label, campaigns: r.campaignCount, adSets: r.adSetCount, ads: r.adCount },
      'Account sync OK',
    );
    return {
      connectionId,
      label,
      ok: true,
      campaigns: r.campaignCount,
      adSets: r.adSetCount,
      ads: r.adCount,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ connectionId, label, err }, 'Account sync FAILED');
    return { connectionId, label, ok: false, error: msg };
  }
}

async function main(): Promise<number> {
  const argId = process.argv[2];

  if (argId) {
    const r = await syncOne(argId, '(by id)');
    console.log(JSON.stringify(r, null, 2));
    return r.ok ? 0 : 1;
  }

  const conns = await db
    .select()
    .from(metaConnections)
    .where(eq(metaConnections.status, 'active'));

  if (conns.length === 0) {
    logger.warn('No active connections; nothing to sync');
    console.log(JSON.stringify({ scanned: 0, results: [] }, null, 2));
    return 0;
  }

  const results: RunResult[] = [];
  for (const c of conns) {
    results.push(await syncOne(c.id, c.accountName));
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(JSON.stringify({ scanned: conns.length, failed, results }, null, 2));
  return failed > 0 ? 1 : 0;
}

let exitCode = 0;
try {
  exitCode = await main();
} catch (err) {
  logger.fatal({ err }, 'Sync runner crashed');
  exitCode = 1;
} finally {
  await closeDb();
}
process.exit(exitCode);
