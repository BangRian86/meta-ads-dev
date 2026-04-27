import {
  buildRoasReport,
  formatRoasReport,
} from '../src/modules/15-closing-tracker/index.js';
import { closeDb } from '../src/modules/00-foundation/index.js';

async function main(): Promise<number> {
  const t0 = Date.now();
  const report = await buildRoasReport(7);
  const ms = Date.now() - t0;
  console.log(`\n=== buildRoasReport(7) took ${ms}ms ===\n`);
  console.log(formatRoasReport(report));
  console.log('\n--- raw per-account ---');
  for (const a of report.perAccount) {
    console.log(
      `${a.accountName}: source=${a.closingSource} closing=${a.closingQuantity} ${a.unit} revenue=${a.revenueIdr} spend=${a.spendIdr} roas=${a.roas.toFixed(2)}${a.closingNote ? ` note=${a.closingNote}` : ''}`,
    );
  }
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
