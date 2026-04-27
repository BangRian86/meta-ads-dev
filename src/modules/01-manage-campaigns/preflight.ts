import {
  campaignFieldsSchema,
  adSetFieldsSchema,
  adFieldsSchema,
  type CampaignFields,
  type AdSetFields,
  type AdFields,
} from './schema.js';

export interface PreflightResult {
  ok: boolean;
  missing: string[];
  warnings: string[];
}

export function preflightCampaign(input: unknown): PreflightResult {
  const parsed = campaignFieldsSchema.safeParse(input);
  if (!parsed.success) return zodIssues(parsed.error.issues);

  const c: CampaignFields = parsed.data;
  const warnings: string[] = [];
  if (c.dailyBudgetMinor != null && c.lifetimeBudgetMinor != null) {
    warnings.push('Both daily_budget and lifetime_budget set; Meta will reject.');
  }
  if (c.specialAdCategories.length === 0) {
    // Meta requires the field but allows []. No warning needed; just informational.
  }
  return { ok: true, missing: [], warnings };
}

export function preflightAdSet(input: unknown): PreflightResult {
  const parsed = adSetFieldsSchema.safeParse(input);
  if (!parsed.success) return zodIssues(parsed.error.issues);

  const a: AdSetFields = parsed.data;
  const warnings: string[] = [];
  const hasOwnBudget =
    a.dailyBudgetMinor != null || a.lifetimeBudgetMinor != null;
  if (!hasOwnBudget) {
    warnings.push(
      'No daily/lifetime budget set on adset — only valid under a CBO campaign.',
    );
  }
  if (a.dailyBudgetMinor != null && a.lifetimeBudgetMinor != null) {
    warnings.push('Both daily_budget and lifetime_budget set; Meta will reject.');
  }
  if (Object.keys(a.targeting).length === 0) {
    warnings.push('Targeting object is empty; Meta will reject.');
  }
  return { ok: true, missing: [], warnings };
}

export function preflightAd(input: unknown): PreflightResult {
  const parsed = adFieldsSchema.safeParse(input);
  if (!parsed.success) return zodIssues(parsed.error.issues);

  const a: AdFields = parsed.data;
  const warnings: string[] = [];
  if (!a.creative.creativeId && !a.creative.creativeSpec) {
    warnings.push('No creative_id or creative_spec provided.');
  }
  return { ok: true, missing: [], warnings };
}

function zodIssues(
  issues: ReadonlyArray<{ path: (string | number)[]; message: string }>,
): PreflightResult {
  const missing: string[] = [];
  const warnings: string[] = [];
  for (const i of issues) {
    const path = i.path.join('.');
    if (i.message.toLowerCase().includes('required')) {
      missing.push(path || '(root)');
    } else {
      warnings.push(`${path || '(root)'}: ${i.message}`);
    }
  }
  return { ok: false, missing, warnings };
}
