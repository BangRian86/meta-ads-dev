import {
  buildRoasReportForRange,
  formatRoasReport,
} from '../src/modules/15-closing-tracker/index.js';
import { parseDateRange } from '../src/modules/10-telegram-bot/date-args.js';
import { closeDb } from '../src/db/index.js';

const cases: Array<string[]> = [
  [],
  ['7d'],
  ['1d'],
  ['24apr'],
  ['2026-04-24'],
  ['1apr', '15apr'],
  ['2026-04-20', '2026-04-25'],
];

async function main(): Promise<number> {
  for (const args of cases) {
    const parsed = parseDateRange(args, { defaultDays: 7 });
    if (!parsed.ok) {
      console.log(`args=${JSON.stringify(args)} → ERROR: ${parsed.reason}`);
      continue;
    }
    const { since, until, label } = parsed.range;
    console.log(`\n=== args=${JSON.stringify(args)} → ${label} (${since} → ${until}) ===`);
    const report = await buildRoasReportForRange({ since, until }, label);
    // Print only one short summary line per case to keep output readable
    console.log(`label=${report.rangeLabel} totalSpend=${report.totalSpendIdr} totalRev=${report.totalRevenueIdr} accounts=${report.perAccount.length}`);
  }
  // Also verify a bad input
  const bad = parseDateRange(['notadate']);
  console.log(`\nBAD: ${JSON.stringify(bad)}`);
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
