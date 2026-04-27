/**
 * Smoke test for the new Sheets-reader commands. Calls handlers directly
 * (bypass Telegraf) and prints the rendered output.
 */
import { closeDb } from '../src/modules/00-foundation/index.js';
import {
  handleAlertCommand,
  handleCabangCommand,
  handleCsCommand,
  handleRoasCommand,
  handleTiktokCommand,
} from '../src/modules/30-sheets-reader/index.js';

async function run(label: string, p: Promise<string>): Promise<void> {
  const t0 = Date.now();
  const r = await p;
  const ms = Date.now() - t0;
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`▶ ${label}  [${ms}ms]`);
  console.log('═'.repeat(60));
  console.log(r);
}

async function main(): Promise<number> {
  await run('/cs (no args, ranking today)', handleCsCommand([]));
  await run('/cs putri', handleCsCommand(['putri']));
  await run('/cs putri 7d', handleCsCommand(['putri', '7d']));
  await run('/cs xxnotexist', handleCsCommand(['xxnotexist']));

  await run('/cabang (ranking)', handleCabangCommand([]));
  await run('/cabang pusat (disambig?)', handleCabangCommand(['pusat']));
  await run('/cabang aqiqah pusat', handleCabangCommand(['aqiqah', 'pusat']));
  await run('/cabang aqiqah pusat 7d', handleCabangCommand(['aqiqah', 'pusat', '7d']));

  await run('/roas (ranking today)', handleRoasCommand([]));
  await run('/roas aqiqah pusat', handleRoasCommand(['aqiqah', 'pusat']));
  await run('/roas aqiqah pusat 7d', handleRoasCommand(['aqiqah', 'pusat', '7d']));
  await run('/roas basmalah pusat 7d (likely empty)', handleRoasCommand(['basmalah', 'pusat', '7d']));

  await run('/tiktok aqiqah pusat', handleTiktokCommand(['aqiqah', 'pusat']));
  await run('/tiktok aqiqah pusat 7d', handleTiktokCommand(['aqiqah', 'pusat', '7d']));

  await run('/alert', handleAlertCommand());

  return 0;
}

let exitCode = 0;
try {
  exitCode = await main();
} catch (err) {
  console.error('CRASH:', err);
  exitCode = 1;
} finally {
  await closeDb();
}
process.exit(exitCode);
