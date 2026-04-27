/**
 * READ-ONLY diagnostic for the "Total campaign aktif: 0" issue on /alerts.
 * Reuses production functions WITHOUT modifying them — simulates the
 * alert-engine pipeline locally with a per-step counter.
 *
 * Usage: npx tsx scripts/debug-detection.ts
 */
import { and, desc, eq } from 'drizzle-orm';
import { closeDb, db } from '../src/db/index.js';
import { metaConnections } from '../src/db/schema/meta-connections.js';
import { metaObjectSnapshots } from '../src/db/schema/meta-object-snapshots.js';
import {
  analyze,
  type DateRange,
  type Target,
} from '../src/modules/02-ads-analysis/index.js';
import {
  buildCampaignRoasForRange,
  buildRoasReportForRange,
} from '../src/modules/15-closing-tracker/index.js';
import {
  detectCampaignType,
  evaluateAlerts,
  getThreshold,
  MIN_SPEND_IDR,
  type Business,
  type CampaignType,
} from '../src/modules/20-roas-alert/index.js';

const PUSAT_AQIQAH_CONN_ID = 'fd7d79c6-ea9c-45fe-8949-bb4139f9c8b4';
const PUSAT_AQIQAH_AD_ACCOUNT = 'act_678662685992005';

function fmtIdr(n: number): string {
  return `Rp ${Math.round(n).toLocaleString('id-ID')}`;
}

function isoDateOffset(daysFromToday: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromToday);
  return d.toISOString().slice(0, 10);
}

function header(title: string): void {
  console.log(`\n${'═'.repeat(60)}\n${title}\n${'═'.repeat(60)}`);
}

// ─────────────── STEP 1 — Detection summary for PUSAT Aqiqah ───────────────

async function step1_detection() {
  header('STEP 1 — Detection result for all PUSAT Aqiqah campaigns');

  const rows = await db
    .select()
    .from(metaObjectSnapshots)
    .where(
      and(
        eq(metaObjectSnapshots.connectionId, PUSAT_AQIQAH_CONN_ID),
        eq(metaObjectSnapshots.objectType, 'campaign'),
      ),
    );
  // Latest snapshot per campaign id, ACTIVE only.
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const cur = latest.get(r.objectId);
    if (!cur || r.fetchedAt.getTime() > cur.fetchedAt.getTime()) {
      latest.set(r.objectId, r);
    }
  }
  const activeCampaigns = [...latest.values()].filter(
    (r) => r.status === 'ACTIVE',
  );
  console.log(
    `Total ACTIVE campaigns (per latest snapshot): ${activeCampaigns.length}`,
  );

  const counts: Record<CampaignType, string[]> = {
    BOFU: [],
    MOFU: [],
    TOFU: [],
    SALES: [],
    DEFAULT: [],
  };
  for (const c of activeCampaigns) {
    const type = detectCampaignType(c.name);
    counts[type].push(c.name);
  }

  console.log('\nDetection per campaign:');
  for (const c of activeCampaigns) {
    const type = detectCampaignType(c.name);
    console.log(`  ${type.padEnd(7)} ← ${c.name}`);
  }

  console.log('\nDetection summary:');
  for (const t of ['BOFU', 'MOFU', 'TOFU', 'SALES', 'DEFAULT'] as CampaignType[]) {
    console.log(`  ${t.padEnd(7)}: ${counts[t].length}`);
  }
  console.log(`  Total : ${activeCampaigns.length}`);

  return { activeCampaigns, counts };
}

// ─────────────── STEP 2 — Pipeline trace for evaluateAlerts ───────────────

interface PipelineCounters {
  rawAllConnections: number;
  rawForBusiness: number;
  belowMinSpend: number;
  noBusinessRevenue: number;
  evaluated: number;
  healthy: number;
  warning: number;
  critical: number;
}

async function step2_pipelineTrace(
  business: Business,
  windowName: string,
  range: DateRange,
): Promise<PipelineCounters> {
  header(
    `STEP 2 — Pipeline trace (business=${business}, window=${windowName} ${range.since} → ${range.until})`,
  );
  // Re-implements evaluateAlerts logic locally so we can count at each step.
  // Production code is NOT modified — this is a parallel inspection.
  const allRows = await buildCampaignRoasForRange(range);

  const counters: PipelineCounters = {
    rawAllConnections: allRows.length,
    rawForBusiness: 0,
    belowMinSpend: 0,
    noBusinessRevenue: 0,
    evaluated: 0,
    healthy: 0,
    warning: 0,
    critical: 0,
  };

  for (const row of allRows) {
    if (row.business !== business) continue;
    counters.rawForBusiness += 1;
    if (row.spendIdr < MIN_SPEND_IDR) {
      counters.belowMinSpend += 1;
      continue;
    }
    if (row.estimatedRevenueIdr === 0) {
      counters.noBusinessRevenue += 1;
      continue;
    }
    counters.evaluated += 1;
    const type = detectCampaignType(row.campaignName);
    const threshold = getThreshold(business, type);
    if (row.roas < threshold.roas_critical) counters.critical += 1;
    else if (row.roas < threshold.roas_warning) counters.warning += 1;
    else counters.healthy += 1;
  }

  console.log(`Step 1 — Raw fetch (all connections):       ${counters.rawAllConnections}`);
  console.log(`Step 2 — After business filter (=${business}):  ${counters.rawForBusiness}`);
  console.log(`Step 3 — Dropped: spend < Rp 50.000:           ${counters.belowMinSpend}`);
  console.log(`Step 4 — Dropped: no Sheets revenue:           ${counters.noBusinessRevenue}`);
  console.log(`Step 5 — Evaluated (passed all filters):       ${counters.evaluated}`);
  console.log(`         ├─ critical: ${counters.critical}`);
  console.log(`         ├─ warning:  ${counters.warning}`);
  console.log(`         └─ healthy:  ${counters.healthy}`);

  return counters;
}

// ─────────────── STEP 3 — Min-spend cross-window analysis ───────────────

async function step3_minSpendAnalysis() {
  header('STEP 3 — Min-spend filter cross-window (PUSAT Aqiqah only)');

  const windows: Array<[string, DateRange]> = [
    ['daily', { since: isoDateOffset(0), until: isoDateOffset(0) }],
    ['weekly (7d)', { since: isoDateOffset(-6), until: isoDateOffset(0) }],
    ['monthly (30d)', { since: isoDateOffset(-29), until: isoDateOffset(0) }],
  ];

  // Get PUSAT Aqiqah active campaigns.
  const rows = await db
    .select()
    .from(metaObjectSnapshots)
    .where(
      and(
        eq(metaObjectSnapshots.connectionId, PUSAT_AQIQAH_CONN_ID),
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
  const active = [...latest.values()].filter((r) => r.status === 'ACTIVE');
  if (active.length === 0) {
    console.log('No active campaigns for PUSAT Aqiqah.');
    return;
  }

  const targets: Target[] = active.map((c) => ({
    type: 'campaign',
    id: c.objectId,
  }));

  for (const [label, range] of windows) {
    let totalSpend = 0;
    let aboveMin = 0;
    let belowMin = 0;
    const belowSamples: string[] = [];
    try {
      const r = await analyze({
        connectionId: PUSAT_AQIQAH_CONN_ID,
        targets,
        range,
      });
      for (const t of r.perTarget) {
        totalSpend += t.summary.spend;
        if (t.summary.spend >= MIN_SPEND_IDR) aboveMin += 1;
        else {
          belowMin += 1;
          if (belowSamples.length < 5 && t.summary.spend > 0) {
            const snap = active.find((c) => c.objectId === t.target.id);
            belowSamples.push(
              `${snap?.name ?? t.target.id} → ${fmtIdr(t.summary.spend)}`,
            );
          }
        }
      }
    } catch (err) {
      console.log(`  ${label}: analyze() failed — ${(err as Error).message}`);
      continue;
    }
    console.log(`\n  ${label} (${range.since} → ${range.until})`);
    console.log(`    total spend across ${active.length} active campaigns: ${fmtIdr(totalSpend)}`);
    console.log(`    spend ≥ Rp 50.000 (passes filter): ${aboveMin}/${active.length}`);
    console.log(`    spend < Rp 50.000 (DROPPED):       ${belowMin}/${active.length}`);
    if (belowSamples.length > 0) {
      console.log(`    sample dropped (with non-zero spend):`);
      for (const s of belowSamples) console.log(`      • ${s}`);
    }
  }
}

// ─────────────── STEP 4 — Compare /alerts vs /roas data sources ───────────────

async function step4_alertsVsRoas() {
  header(
    'STEP 4 — /alerts vs /roas data-source compare (Aqiqah, today)',
  );
  const range: DateRange = {
    since: isoDateOffset(0),
    until: isoDateOffset(0),
  };

  // /alerts internals
  const alertResult = await evaluateAlerts('aqiqah', 'daily');
  console.log('\n/alerts evaluateAlerts("aqiqah", "daily"):');
  console.log(
    `  alerts.length = ${alertResult.alerts.length} (crit=${alertResult.alerts.filter((a) => a.severity === 'critical').length}, warn=${alertResult.alerts.filter((a) => a.severity === 'warning').length})`,
  );
  console.log(`  healthyCount       = ${alertResult.healthyCount}`);
  console.log(`  belowMinSpendCount = ${alertResult.belowMinSpendCount}`);
  console.log(`  noBusinessCount    = ${alertResult.noBusinessCount}`);
  const evaluated =
    alertResult.healthyCount + alertResult.alerts.length;
  console.log(`  → evaluated total  = ${evaluated} (= healthy + alerts)`);

  // /roas internals — uses buildRoasReportForRange (account-level aggregation)
  const roasReport = await buildRoasReportForRange(range, 'today');
  const aqiqahAccounts = roasReport.perAccount.filter((a) =>
    a.accountName.toLowerCase().includes('aqiqah'),
  );
  console.log('\n/roas buildRoasReportForRange(today):');
  for (const a of aqiqahAccounts) {
    console.log(
      `  ${a.accountName.padEnd(28)} spend=${fmtIdr(a.spendIdr).padEnd(15)} rev=${fmtIdr(a.revenueIdr).padEnd(15)} closing=${a.closingQuantity} ${a.unit} ROAS=${a.roas.toFixed(2)}x source=${a.closingSource}`,
    );
  }
  const aqiqahSpendTotal = aqiqahAccounts.reduce((s, x) => s + x.spendIdr, 0);
  const aqiqahRevTotal = aqiqahAccounts.reduce((s, x) => s + x.revenueIdr, 0);
  console.log(
    `  Aqiqah TOTAL: spend=${fmtIdr(aqiqahSpendTotal)} rev=${fmtIdr(aqiqahRevTotal)}`,
  );

  console.log('\nInterpretasi:');
  if (
    aqiqahSpendTotal > 0 &&
    alertResult.belowMinSpendCount > 0 &&
    evaluated === 0
  ) {
    console.log(
      `  ✓ /roas LIHAT spend (${fmtIdr(aqiqahSpendTotal)}) tapi /alerts EVALUATE 0`,
    );
    console.log(
      `  ✓ Penyebab: ${alertResult.belowMinSpendCount} campaign Aqiqah ke-skip karena spend < Rp 50.000/hari`,
    );
  }
}

// ─────────────── STEP 5 — Connection sanity check ───────────────

async function step0_connections() {
  header('STEP 0 — Connection inventory (sanity)');
  const conns = await db
    .select()
    .from(metaConnections)
    .orderBy(desc(metaConnections.createdAt));
  console.log(
    `Found ${conns.length} connection(s):`,
  );
  for (const c of conns) {
    const tag = c.adAccountId === '678662685992005' ? '  ← target' : '';
    console.log(
      `  ${c.id} | ${c.accountName.padEnd(28)} act_${c.adAccountId} | status=${c.status}${tag}`,
    );
  }
  const target = conns.find((c) => c.id === PUSAT_AQIQAH_CONN_ID);
  if (!target) {
    console.log(`\n❌ PUSAT Aqiqah connection ${PUSAT_AQIQAH_CONN_ID} NOT FOUND`);
    process.exit(1);
  }
  if (target.adAccountId !== '678662685992005') {
    console.log(
      `\n⚠️  Connection has ad_account_id=${target.adAccountId}, expected 678662685992005`,
    );
  }
  if (target.status !== 'active') {
    console.log(`\n⚠️  Target connection status=${target.status}, not 'active'`);
  }
}

// ─────────────── Main ───────────────

async function main(): Promise<number> {
  console.log(
    `🔧 DIAGNOSTIC for /alerts "Total campaign aktif: 0" issue\n` +
      `Account: ${PUSAT_AQIQAH_AD_ACCOUNT} (PUSAT - AQIQAH EXPRESS)\n` +
      `Connection: ${PUSAT_AQIQAH_CONN_ID}\n` +
      `Today: ${isoDateOffset(0)} (UTC)`,
  );

  await step0_connections();

  const { activeCampaigns, counts } = await step1_detection();

  // Run pipeline trace for each window
  const dailyTrace = await step2_pipelineTrace('aqiqah', 'daily', {
    since: isoDateOffset(0),
    until: isoDateOffset(0),
  });
  const weeklyTrace = await step2_pipelineTrace('aqiqah', 'weekly', {
    since: isoDateOffset(-6),
    until: isoDateOffset(0),
  });
  const monthlyTrace = await step2_pipelineTrace('aqiqah', 'monthly', {
    since: isoDateOffset(-29),
    until: isoDateOffset(0),
  });

  await step3_minSpendAnalysis();

  await step4_alertsVsRoas();

  // ─────────────── Final root-cause report ───────────────
  header('🎯 ROOT CAUSE REPORT');

  console.log(`Account: ${PUSAT_AQIQAH_AD_ACCOUNT} (PUSAT - AQIQAH EXPRESS)`);
  console.log(`Today (UTC): ${isoDateOffset(0)}`);

  console.log('\n📊 Detection Summary (PUSAT Aqiqah only):');
  for (const t of ['BOFU', 'MOFU', 'TOFU', 'SALES', 'DEFAULT'] as CampaignType[]) {
    const sample = counts[t][0]
      ? ` (sample: "${counts[t][0]?.slice(0, 50)}")`
      : '';
    console.log(`  ${t.padEnd(7)}: ${counts[t].length}${sample}`);
  }
  console.log(`  TOTAL  : ${activeCampaigns.length} ACTIVE per latest snapshot`);

  console.log('\n📊 Pipeline Trace (entire Aqiqah business, all 4 accounts):');
  for (const [label, t] of [
    ['daily', dailyTrace],
    ['weekly', weeklyTrace],
    ['monthly', monthlyTrace],
  ] as Array<[string, PipelineCounters]>) {
    console.log(
      `  ${label.padEnd(8)} fetched=${t.rawForBusiness}, evaluated=${t.evaluated}, dropped(min-spend)=${t.belowMinSpend}, dropped(no-rev)=${t.noBusinessRevenue}, alerts=${t.critical + t.warning} (crit=${t.critical}, warn=${t.warning}), healthy=${t.healthy}`,
    );
  }

  console.log('\n────────────────────────────────────────────────────────');
  console.log('🎯 ROOT CAUSE');
  console.log('────────────────────────────────────────────────────────');

  const dailyDropPct =
    dailyTrace.rawForBusiness === 0
      ? 0
      : Math.round(
          ((dailyTrace.belowMinSpend + dailyTrace.noBusinessRevenue) /
            dailyTrace.rawForBusiness) *
            100,
        );

  if (dailyTrace.evaluated === 0 && dailyTrace.belowMinSpend > 0) {
    console.log(
      `\nMin-spend filter Rp ${MIN_SPEND_IDR.toLocaleString('id-ID')} terlalu agresif untuk window daily.`,
    );
    console.log(
      `Dari ${dailyTrace.rawForBusiness} campaign Aqiqah, ${dailyTrace.belowMinSpend} (${Math.round((dailyTrace.belowMinSpend / dailyTrace.rawForBusiness) * 100)}%) di-skip karena spend hari ini < Rp 50.000.`,
    );
    console.log(
      `Sisa ${dailyTrace.rawForBusiness - dailyTrace.belowMinSpend}, dari sini ${dailyTrace.noBusinessRevenue} di-skip lagi karena Sheets belum punya closing hari ini.`,
    );
    console.log(
      `Hasil akhir: ${dailyTrace.evaluated} campaign yang ter-evaluasi → output "Total campaign aktif: 0" ✓ konsisten dengan bug yang dilaporkan.`,
    );
    console.log(
      `\nBandingkan dengan window weekly/monthly: bottleneck min-spend hilang (${weeklyTrace.evaluated}/${weeklyTrace.rawForBusiness} & ${monthlyTrace.evaluated}/${monthlyTrace.rawForBusiness} ter-evaluasi).`,
    );
    console.log(
      `Pattern Aqiqah: budget per-campaign Rp 200-360rb/day di-spread ke banyak campaign, jadi spend per-campaign per-day rata-rata Rp 20-50rb. Daily window pasti banyak yang ke-filter.`,
    );
    console.log(
      `\nDrop rate harian: ${dailyDropPct}% dari semua campaign Aqiqah ke-skip di window daily.`,
    );
  } else if (dailyTrace.rawForBusiness === 0) {
    console.log(
      `\n⚠️  buildCampaignRoasForRange tidak return campaign Aqiqah sama sekali — bug-nya di lapisan fetching, bukan di filter.`,
    );
  } else {
    console.log(
      `\n⚠️  Pattern bottleneck tidak match hipotesis. Periksa output di atas.`,
    );
  }

  console.log('\n────────────────────────────────────────────────────────');
  console.log('🛠️  RECOMMENDED FIX OPTIONS (TIDAK auto-apply)');
  console.log('────────────────────────────────────────────────────────');
  console.log(`
Option 1 — Per-business min-spend constant
   Aqiqah: Rp 20.000 (cocok dengan pola spend 20-50rb/day per campaign)
   Basmalah: Rp 50.000 (tetap, ticket size beda)
   Trade-off: simple, tapi hardcoded angka per-bisnis bertambah satu lagi.

Option 2 — Min-spend skala by window
   daily: Rp 20.000   weekly: Rp 50.000   monthly: Rp 200.000
   Trade-off: scaling-nya intuitif (1d ≪ 7d ≪ 30d), masih satu config per window.

Option 3 — Min-spend = persentase budget harian campaign
   Threshold = max(10% × daily_budget, Rp 5.000)
   Trade-off: paling akurat, tapi butuh budget per campaign (sudah ada via
   detectBudgetOwner di module 04). Lebih banyak DB hits per evaluation.

Option 4 — Drop min-spend di daily, keep di weekly/monthly
   Trade-off: paling sedikit kode berubah. Daily akan punya banyak alert
   "ROAS 0x" yang kurang actionable. Bisa dicombine dengan exclude-zero
   filter di formatter.

Option 5 — Status quo + dokumentasikan
   Tambahkan note di output /alerts: "Sebagian campaign di-skip karena
   spend kecil — pakai /alerts weekly buat lihat lengkap."
   Trade-off: nol risiko, tapi bug perception ("kenapa kosong?") tetap.
`);

  console.log(
    '\n✅ Diagnostic selesai. Read-only — tidak ada perubahan di production code.',
  );
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
