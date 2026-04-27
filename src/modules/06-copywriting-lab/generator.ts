import type { CopyBrief } from '../../db/schema/copy-briefs.js';
import { parseBrief } from './brief-store.js';
import type { VariantFields } from './schema.js';

interface AngleTemplate {
  name: string;
  primary: (ctx: GenerationContext) => string;
  headline: (ctx: GenerationContext) => string;
  description?: (ctx: GenerationContext) => string;
}

const CTA_BY_ACTION: Record<string, string[]> = {
  shop_now: ['Shop Now', 'Buy Now', 'Order Today'],
  sign_up: ['Sign Up', 'Join Free', 'Create Account'],
  learn_more: ['Learn More', 'See How', 'Discover More'],
  download: ['Download Now', 'Get the App', 'Install Free'],
  book: ['Book Now', 'Reserve Your Spot', 'Schedule Today'],
  contact_us: ['Contact Us', 'Get a Quote', 'Talk to Sales'],
  default: ['Learn More', 'Get Started', 'Try It Free'],
};

const ANGLES: AngleTemplate[] = [
  {
    name: 'benefit_led',
    primary: (c) =>
      `${c.audienceLine}${c.product ? ` deserves ${c.product}.` : ''} ` +
      `${c.benefitsLine || 'Built to deliver real results, day after day.'}`,
    headline: (c) =>
      c.benefits[0]
        ? `${capitalize(c.benefits[0])} — without compromise`
        : `Made for ${c.audience ?? 'you'}`,
    description: (c) => `Everything you need from ${c.product ?? 'one'}.`,
  },
  {
    name: 'urgency_led',
    primary: (c) =>
      `Don't wait. ${c.product ? `${capitalize(c.product)} ` : ''}` +
      `${c.benefits[0] ? `gives you ${c.benefits[0]}` : 'is in demand right now'} — ` +
      `and stock moves fast. ${c.audienceLine ? `For ${c.audience}, this is the moment.` : ''}`,
    headline: () => `Limited time — act now`,
    description: (c) => `Selling fast. ${c.audience ? `Loved by ${c.audience}.` : 'Loved by thousands.'}`,
  },
  {
    name: 'social_proof',
    primary: (c) =>
      `Thousands ${c.audience ? `of ${c.audience} ` : ''}already chose ` +
      `${c.product ?? 'us'}. ${c.benefits[0] ? `They got ${c.benefits[0]}.` : ''} ` +
      `Find out why.`,
    headline: () => `Why people switch`,
    description: () => `Real customers. Real results.`,
  },
  {
    name: 'problem_solution',
    primary: (c) =>
      `Tired of ${c.audience ? `the same old options as ${c.audience}` : 'compromise'}? ` +
      `${c.product ? `${capitalize(c.product)} fixes that. ` : ''}` +
      `${c.benefitsLine || 'One product, the outcomes you actually want.'}`,
    headline: (c) =>
      c.benefits[0]
        ? `Finally — ${c.benefits[0]}`
        : `Stop settling, start winning`,
    description: (c) => `Designed around ${c.audience ?? 'you'}.`,
  },
  {
    name: 'curiosity',
    primary: (c) =>
      `What if ${c.benefits[0] ?? 'a single change'} could ` +
      `transform ${c.audience ? `how ${c.audience} work` : 'your day'}? ` +
      `${c.product ? `Meet ${c.product}.` : 'Take a look.'}`,
    headline: () => `You haven't seen this yet`,
    description: (c) => `${c.audience ?? 'Curious minds'} are talking.`,
  },
  {
    name: 'inspirational',
    primary: (c) =>
      `Every great ${c.audience ?? 'journey'} starts with one decision. ` +
      `${c.product ? `${capitalize(c.product)} is yours.` : 'Make yours today.'} ` +
      `${c.benefitsLine}`,
    headline: () => `Begin something better`,
    description: () => `Built for the next chapter.`,
  },
  {
    name: 'data_driven',
    primary: (c) =>
      `${c.benefits[0] ? `${capitalize(c.benefits[0])}.` : 'Measurable outcomes.'} ` +
      `${c.benefits[1] ? `${capitalize(c.benefits[1])}.` : 'Lower cost.'} ` +
      `${c.benefits[2] ? `${capitalize(c.benefits[2])}.` : 'Faster setup.'} ` +
      `That's ${c.product ?? 'what you get'}.`,
    headline: (c) =>
      c.benefits[0] ? `${capitalize(c.benefits[0])} — measured` : `Numbers don't lie`,
    description: () => `Backed by real metrics.`,
  },
  {
    name: 'casual_friendly',
    primary: (c) =>
      `Hey ${c.audience ? c.audience : 'friend'} — ` +
      `${c.product ? `we built ${c.product} ` : `we built something `}` +
      `${c.benefits[0] ? `to help with ${c.benefits[0]}` : 'with you in mind'}. ` +
      `Want to take a look?`,
    headline: () => `A small thing that helps a lot`,
    description: () => `No fluff. Just the good stuff.`,
  },
];

interface GenerationContext {
  audience: string | null;
  audienceLine: string;
  product: string | null;
  benefits: string[];
  benefitsLine: string;
}

export function generateVariants(
  brief: CopyBrief,
  options: { count?: number; language?: string } = {},
): VariantFields[] {
  const parsed = parseBrief(brief);
  const ctx: GenerationContext = {
    audience: brief.audience ?? null,
    audienceLine: brief.audience ? `${capitalize(brief.audience)} ` : '',
    product: brief.product ?? null,
    benefits: parsed.keyBenefits,
    benefitsLine:
      parsed.keyBenefits.length > 0
        ? `What you get: ${parsed.keyBenefits.slice(0, 3).join(', ')}.`
        : '',
  };

  const angles = pickAngles(brief, options.count ?? 3);
  const ctas = ctaCandidates(brief.targetAction);

  const variants = angles.map((angle, i): VariantFields => {
    const primary = sanitize(angle.primary(ctx), parsed.forbiddenWords);
    const headline = sanitize(angle.headline(ctx), parsed.forbiddenWords);
    const description = angle.description
      ? sanitize(angle.description(ctx), parsed.forbiddenWords)
      : undefined;
    const cta = ctas[i % ctas.length] ?? 'Learn More';
    const variant: VariantFields = {
      primaryText: primary,
      headline,
      cta,
    };
    if (description) variant.description = description;
    if (options.language) variant.language = options.language;
    return variant;
  });

  return variants;
}

function pickAngles(brief: CopyBrief, count: number): AngleTemplate[] {
  let pool = [...ANGLES];
  if (brief.tone === 'urgent') {
    pool = prioritize(pool, ['urgency_led', 'problem_solution', 'data_driven']);
  } else if (brief.tone === 'inspirational') {
    pool = prioritize(pool, ['inspirational', 'benefit_led', 'curiosity']);
  } else if (brief.tone === 'casual' || brief.tone === 'friendly') {
    pool = prioritize(pool, ['casual_friendly', 'curiosity', 'benefit_led']);
  } else if (brief.tone === 'professional') {
    pool = prioritize(pool, ['data_driven', 'benefit_led', 'social_proof']);
  }
  return pool.slice(0, Math.min(count, pool.length));
}

function ctaCandidates(targetAction: string | null): string[] {
  if (!targetAction) return CTA_BY_ACTION.default ?? ['Learn More'];
  const normalized = targetAction.trim().toLowerCase().replace(/\s+/g, '_');
  return CTA_BY_ACTION[normalized] ?? CTA_BY_ACTION.default ?? ['Learn More'];
}

function prioritize(pool: AngleTemplate[], priority: string[]): AngleTemplate[] {
  const ranked = [...pool].sort((a, b) => {
    const ai = priority.indexOf(a.name);
    const bi = priority.indexOf(b.name);
    const av = ai === -1 ? Number.MAX_SAFE_INTEGER : ai;
    const bv = bi === -1 ? Number.MAX_SAFE_INTEGER : bi;
    return av - bv;
  });
  return ranked;
}

function sanitize(text: string, forbidden: string[]): string {
  let out = text.replace(/\s+/g, ' ').trim();
  for (const w of forbidden) {
    if (!w) continue;
    const re = new RegExp(`\\b${escapeRegex(w)}\\b`, 'gi');
    out = out.replace(re, '[redacted]');
  }
  return out;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function capitalize(s: string): string {
  if (!s) return s;
  const head = s.charAt(0).toUpperCase();
  return head + s.slice(1);
}
