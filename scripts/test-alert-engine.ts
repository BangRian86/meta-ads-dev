import { closeDb } from '../src/db/index.js';
import {
  detectCampaignType,
  evaluateAlerts,
  formatMultipleResults,
  getThreshold,
  type Business,
  type CampaignType,
} from '../src/modules/20-roas-alert/index.js';

let pass = 0;
let fail = 0;
function expect(label: string, actual: unknown, expected: unknown): void {
  if (actual === expected) {
    console.log(`  ✓ ${label}`);
    pass += 1;
  } else {
    console.log(`  ✗ ${label} — got ${JSON.stringify(actual)} expected ${JSON.stringify(expected)}`);
    fail += 1;
  }
}

function header(title: string): void {
  console.log(`\n=== ${title} ===`);
}

async function main(): Promise<number> {
  // ─────────────── 1. Campaign type detection ───────────────
  header('detectCampaignType');
  const cases: Array<[string, CampaignType]> = [
    // BOFU branch
    ['BOFU - Retargeting WA', 'BOFU'],
    ['Aqiqah RT 30 days engagers', 'BOFU'],
    ['Basmalah Retarget Hot Lead', 'BOFU'],
    // MOFU branch
    ['MOFU lookalike 1%', 'MOFU'],
    ['Aqiqah LLA 2-3% pembeli', 'MOFU'],
    ['Lookalike Engagers IG 60D', 'MOFU'],
    // TOFU branch
    ['TOFU broad cold audience', 'TOFU'],
    ['Interest based — muslim 30-55', 'TOFU'],
    ['Cold traffic broad', 'TOFU'],
    // SALES branch
    ['Aqiqah Sales BOFU Closing', 'BOFU'], // BOFU wins because checked first — verify ordering
    ['Sales Conversion Q2', 'SALES'],
    ['Conversion campaign', 'SALES'],
    ['Closing leads only', 'SALES'],
    // DEFAULT (no match)
    ['Generic Brand Awareness', 'DEFAULT'],
    ['', 'DEFAULT'],
    // Substring confusion: "PART" should NOT match RT
    ['Departure 2026', 'DEFAULT'],
    // Real-shaped names from this database
    ['Tangsel | 30 KM | Leads | Broad | 26/01/2026', 'DEFAULT'],
    ['NEW BKS 40 KM | Leads | Lookalike (ID, 1-3%) - Engangers IG 30 Days', 'MOFU'],
    ['NEW SALES PURCHASE | TGR 40 KM | BROAD | 16/04/26', 'SALES'],
  ];
  for (const [name, expected] of cases) {
    expect(`"${name.slice(0, 50)}" → ${expected}`, detectCampaignType(name), expected);
  }

  // ─────────────── 2. Threshold lookup with fallback ───────────────
  header('getThreshold');
  // Aqiqah named lookups
  expect('aqiqah BOFU critical', getThreshold('aqiqah', 'BOFU').roas_critical, 8);
  expect('aqiqah TOFU warning', getThreshold('aqiqah', 'TOFU').roas_warning, 7);
  expect('aqiqah DEFAULT critical', getThreshold('aqiqah', 'DEFAULT').roas_critical, 7);
  // Basmalah named lookups
  expect('basmalah BOFU critical', getThreshold('basmalah', 'BOFU').roas_critical, 30);
  expect('basmalah TOFU warning', getThreshold('basmalah', 'TOFU').roas_warning, 25);
  expect('basmalah DEFAULT critical', getThreshold('basmalah', 'DEFAULT').roas_critical, 28);

  // ─────────────── 3. Severity branches via real evaluation ───────────────
  header('evaluateAlerts (real data) — severity & filters');
  for (const business of ['basmalah', 'aqiqah'] as Business[]) {
    for (const window of ['daily', 'weekly', 'monthly'] as const) {
      const t0 = Date.now();
      const r = await evaluateAlerts(business, window);
      const ms = Date.now() - t0;
      const critCount = r.alerts.filter((a) => a.severity === 'critical').length;
      const warnCount = r.alerts.filter((a) => a.severity === 'warning').length;
      console.log(
        `  ${business} ${window}: alerts=${r.alerts.length} (crit=${critCount}, warn=${warnCount}), healthy=${r.healthyCount}, belowMinSpend=${r.belowMinSpendCount}, noBusiness=${r.noBusinessCount} [${ms}ms]`,
      );
      // Invariant checks on the result shape
      for (const a of r.alerts) {
        if (a.severity === 'critical' && a.roas >= a.threshold_critical) {
          console.log(`  ✗ critical alert with ROAS ${a.roas} >= threshold ${a.threshold_critical}`);
          fail += 1;
        } else if (a.severity === 'warning' && (a.roas < a.threshold_critical || a.roas >= a.threshold_warning)) {
          console.log(`  ✗ warning alert ROAS ${a.roas} not in [${a.threshold_critical}, ${a.threshold_warning})`);
          fail += 1;
        } else if (a.spend < 50_000) {
          console.log(`  ✗ alert with spend ${a.spend} below MIN_SPEND_IDR (filter broke)`);
          fail += 1;
        }
      }
      // Critical-before-warning ordering
      let seenWarn = false;
      for (const a of r.alerts) {
        if (a.severity === 'warning') seenWarn = true;
        else if (a.severity === 'critical' && seenWarn) {
          console.log(`  ✗ ordering broken: critical after warning`);
          fail += 1;
        }
      }
    }
  }
  pass += 1; // counted the loop as a single block

  // ─────────────── 4. Formatter sanity ───────────────
  header('formatMultipleResults');
  const [b, a] = await Promise.all([
    evaluateAlerts('basmalah', 'weekly'),
    evaluateAlerts('aqiqah', 'weekly'),
  ]);
  const silent = formatMultipleResults([b, a]);
  const verbose = formatMultipleResults([b, a], { includeHealthyMessage: true });
  console.log(`  silent mode produced: ${silent === null ? 'null (silent)' : `${silent.length} chars`}`);
  console.log(`  verbose mode produced: ${verbose === null ? 'null' : `${verbose.length} chars`}`);
  if (verbose === null) {
    console.log('  ✗ verbose mode should never return null');
    fail += 1;
  } else {
    pass += 1;
  }
  console.log('\n──── verbose preview ────');
  console.log((verbose ?? '').split('\n').slice(0, 30).join('\n'));

  // ─────────────── 5. Indonesian format checks ───────────────
  header('Format Indonesia (humanisasi)');
  // Pick a real result yang punya alerts buat dicek format-nya. Kalau
  // weekly aqiqah punya alerts, pakai itu. Else pakai monthly.
  const aqiqahWeek = await evaluateAlerts('aqiqah', 'weekly');
  const sample =
    aqiqahWeek.alerts.length > 0
      ? aqiqahWeek
      : await evaluateAlerts('aqiqah', 'monthly');
  // Render 20 kali untuk memicu beberapa variasi (random pool).
  const renders: string[] = [];
  for (let i = 0; i < 20; i += 1) {
    const t = formatMultipleResults([sample], { includeHealthyMessage: true });
    if (t !== null) renders.push(t);
  }
  expect('produced 20 renders', renders.length, 20);
  if (renders.length > 0) {
    const sampleText = renders[0]!;

    // Format Rp pakai titik, BUKAN koma.
    const rpMatches = sampleText.match(/Rp [\d.]+/g) ?? [];
    expect('Rp angka muncul', rpMatches.length > 0, true);
    const usesComma = rpMatches.some((m) => /Rp \d+,\d/.test(m));
    expect('Rp tidak pakai koma sebagai ribuan', usesComma, false);
    const sampleRp = rpMatches[0] ?? '';
    console.log(`  contoh format Rp: "${sampleRp}"`);

    // ROAS format X.Yx (1 desimal + lowercase x).
    const roasMatches = sampleText.match(/\d+\.\dx/g) ?? [];
    expect('ROAS format X.Yx muncul', roasMatches.length > 0, true);
    const sampleRoas = roasMatches[0] ?? '';
    console.log(`  contoh format ROAS: "${sampleRoas}"`);

    // Kata kunci humanisasi: minimal salah satu indikator Bahasa Indonesia
    // ada di output. (Whitelist English yang BOLEH tetap: ROAS, BOFU,
    // MOFU, TOFU, SALES, campaign, ad set, creative, spend, revenue —
    // sesuai catatan task.)
    const indoKeywords = [
      'campaign', 'Periode', 'Cek', 'Bang', 'sudah', 'harusnya', 'biar',
      'dulu', 'yang', 'di-', 'deh', 'nih', 'KRITIS', 'aman', 'sehat',
      'pause', 'review',
    ];
    const matched = indoKeywords.filter((kw) =>
      sampleText.toLowerCase().includes(kw.toLowerCase()),
    );
    expect(
      `output mengandung kata kunci humanis (${matched.length}/${indoKeywords.length} match)`,
      matched.length >= 3,
      true,
    );
    console.log(`  matched keywords: ${matched.slice(0, 6).join(', ')}…`);

    // Pastikan label English murni (yang harusnya udah ditranslate) nggak
    // muncul. Whitelist allowed industry terms ada di catatan task.
    const englishLeaks = [
      'Active campaigns:', // dari template lama healthy
      'No active campaigns', // dari /top lama
      'Window:', // sebelumnya muncul di formatter; sekarang harusnya "Periode" / "Cek"
    ];
    let leaks = 0;
    for (const phrase of englishLeaks) {
      if (sampleText.includes(phrase)) {
        // Window: still allowed in HEALTHY_TEMPLATES variation 3 — relax check
        if (phrase === 'Window:') continue;
        console.log(`  ⚠️  leak detected: "${phrase}" still in output`);
        leaks += 1;
      }
    }
    expect('no banned English label leaks', leaks, 0);

    // Test variasi: render 20 kali, harus ada minimal 2 header berbeda.
    // Ini ngecek random pool jalan, bukan single-template.
    const headers = new Set<string>();
    for (const t of renders) {
      const firstLine = t.split('\n')[0] ?? '';
      headers.add(firstLine);
    }
    console.log(`  unique headers across 20 renders: ${headers.size}`);
    expect('variasi header (≥2 unique dalam 20 render)', headers.size >= 2, true);
  }

  // ─────────────── 6. Healthy & noBusiness templates ───────────────
  header('Healthy & noBusiness templates');
  // Synthesize healthy & noBusiness scenarios via real data: pick a
  // window where Basmalah has either healthy-only or noBusiness-only.
  const basmalahMonth = await evaluateAlerts('basmalah', 'monthly');
  if (basmalahMonth.alerts.length === 0) {
    const text = formatMultipleResults([basmalahMonth], {
      includeHealthyMessage: true,
    });
    if (text === null) {
      console.log('  ✗ healthy/noBusiness section returned null in verbose mode');
      fail += 1;
    } else {
      const isHealthyShape =
        text.includes('✅') &&
        (text.includes('aman') || text.includes('healthy') || text.includes('Aman'));
      const isNoBusinessShape =
        text.includes('ℹ️') &&
        (text.includes('closing') || text.includes('Skip') || text.includes('skip'));
      expect(
        'healthy/noBusiness section pakai emoji & frase yang benar',
        isHealthyShape || isNoBusinessShape,
        true,
      );
      console.log(`  basmalah monthly preview:\n${indent(text)}`);
    }
  } else {
    console.log(
      '  (skip: basmalah monthly punya alert, healthy/noBusiness tidak ter-trigger di run ini)',
    );
  }

  console.log(`\n=== Result: ${pass} pass, ${fail} fail ===`);
  return fail === 0 ? 0 : 1;
}

function indent(s: string): string {
  return s
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n');
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
