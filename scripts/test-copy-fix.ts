import { generateAiVariantsForBadAd } from '../src/modules/06-copywriting-lab/index.js';

const ctx = {
  campaignId: '120241551673980312',
  campaignName: 'Tangsel | 30 KM | Leads | Broad | 26/01/2026',
  objective: 'OUTCOME_LEADS',
  cprIdr: 75_000,
  cprThresholdIdr: 50_000,
  spendIdr: 2_400_000,
  results: 32,
  ctrPct: 0.9,
  ageDays: 89,
  resultActionType: 'lead',
  brand: 'aqiqah' as const, // smoke aqiqah-branded prompt
};

async function main() {
  const t0 = Date.now();
  const result = await generateAiVariantsForBadAd(ctx);
  const ms = Date.now() - t0;

  console.log(`\n--- generateAiVariantsForBadAd took ${ms}ms (brand=${ctx.brand}) ---\n`);

  if (!result.ok) {
    console.error('FAILED:', result.reason);
    process.exit(1);
  }

  const { variants, rationales, audienceSuggestion } = result.data;
  console.log(`OK — got ${variants.length}/3 variants`);
  console.log(`Audience suggestion: ${audienceSuggestion}\n`);

  for (let i = 0; i < variants.length; i += 1) {
    const v = variants[i]!;
    const r = rationales[i] ?? '';
    console.log(`--- variant ${i + 1} ---`);
    console.log(`headline (${v.headline.length}): ${v.headline}`);
    console.log(`cta (${v.cta.length}): ${v.cta}`);
    console.log(`primaryText (${v.primaryText.length}):`);
    console.log(v.primaryText);
    console.log(`rationale (${r.length}):`);
    console.log(r);
    console.log();
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('CRASHED:', err);
  process.exit(1);
});
