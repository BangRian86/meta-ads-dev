import { eq } from 'drizzle-orm';
import { db, closeDb } from '../src/modules/00-foundation/index.js';
import { metaConnections } from '../src/db/schema/index.js';
import { detectBudgetOwner } from '../src/modules/04-budget-control/index.js';
import { appConfig as config } from '../src/modules/00-foundation/index.js';

interface TestPair {
  label: string;
  campaignId: string;
  adsetId: string;
}

const PAIRS: TestPair[] = [
  { label: 'C3 - KVR CTWA | BOFU', campaignId: '120245752388710209', adsetId: '120245752388700209' },
  { label: 'C2 - LEADS CTWA | MOFU', campaignId: '120246580753940209', adsetId: '120246580753960209' },
  { label: 'Traffic - Profile Visit', campaignId: '120246736609490209', adsetId: '120246736609500209' },
];

async function main() {
  const [conn] = await db
    .select()
    .from(metaConnections)
    .where(eq(metaConnections.status, 'active'))
    .limit(1);
  if (!conn) {
    console.error('No active connection');
    process.exit(1);
  }
  const factor = config.optimizer.currencyMinorPerUnit;
  console.log(`Connection: ${conn.accountName}`);
  console.log(`Currency factor: ${factor} minor per major\n`);

  for (const p of PAIRS) {
    console.log(`=== ${p.label} ===`);
    // Test campaign-level (CBO check)
    try {
      const owner = await detectBudgetOwner(conn.id, { type: 'campaign', id: p.campaignId });
      const daily = owner.dailyBudgetMinor != null ? `Rp ${(owner.dailyBudgetMinor / factor).toLocaleString('id-ID')}` : '-';
      const lifetime = owner.lifetimeBudgetMinor != null ? `Rp ${(owner.lifetimeBudgetMinor / factor).toLocaleString('id-ID')}` : '-';
      console.log(`  campaign owner: ${owner.ownerType} ${owner.ownerId} (${owner.level}) — daily ${daily} / lifetime ${lifetime}`);
    } catch (err) {
      console.log(`  campaign-level: ${err instanceof Error ? err.message : err}`);
    }
    // Test adset-level (ABO check)
    try {
      const owner = await detectBudgetOwner(conn.id, { type: 'adset', id: p.adsetId });
      const daily = owner.dailyBudgetMinor != null ? `Rp ${(owner.dailyBudgetMinor / factor).toLocaleString('id-ID')}` : '-';
      const lifetime = owner.lifetimeBudgetMinor != null ? `Rp ${(owner.lifetimeBudgetMinor / factor).toLocaleString('id-ID')}` : '-';
      console.log(`  adset owner: ${owner.ownerType} ${owner.ownerId} (${owner.level}) — daily ${daily} / lifetime ${lifetime}`);
    } catch (err) {
      console.log(`  adset-level: ${err instanceof Error ? err.message : err}`);
    }
    console.log('');
  }
  await closeDb();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
