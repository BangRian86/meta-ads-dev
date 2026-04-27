import type { CopyBrief } from '../../db/schema/copy-briefs.js';
import { parseBrief } from './brief-store.js';
import type { ReviewResult, VariantFields } from './schema.js';

const EMOTIONAL_WORDS = [
  'love',
  'breakthrough',
  'transform',
  'amazing',
  'incredible',
  'unforgettable',
  'imagine',
  'discover',
  'effortless',
  'powerful',
  'beautiful',
  'inspiring',
  'thrilling',
  'remarkable',
  'finally',
];

const URGENCY_WORDS = [
  'now',
  'today',
  'limited',
  "don't wait",
  "act now",
  'last chance',
  'only',
  'ends',
  'before',
  'fast',
];

const STRONG_CTA_VERBS = [
  'shop',
  'buy',
  'get',
  'start',
  'sign',
  'join',
  'try',
  'book',
  'reserve',
  'download',
  'install',
  'claim',
  'unlock',
  'discover',
  'see',
  'order',
];

const WEAK_CTA_PHRASES = ['click here', 'submit', 'ok', 'next', 'continue'];

export function reviewVariant(
  variant: VariantFields,
  brief: CopyBrief | null = null,
): ReviewResult {
  const clarity = scoreClarity(variant);
  const emotional = scoreEmotionalAppeal(variant);
  const ctaStrength = scoreCtaStrength(variant);
  const relevance = scoreRelevance(variant, brief);

  const overall = round(
    (clarity.score + emotional.score + ctaStrength.score + relevance.score) / 4,
  );

  const strengths: string[] = [];
  const improvements: string[] = [];
  for (const dim of [clarity, emotional, ctaStrength, relevance]) {
    if (dim.score >= 75) strengths.push(`${dim.dimension}: ${dim.note}`);
    else if (dim.score < 50) improvements.push(`${dim.dimension}: ${dim.note}`);
  }

  return {
    score: {
      clarity: clarity.score,
      emotionalAppeal: emotional.score,
      ctaStrength: ctaStrength.score,
      relevance: relevance.score,
      overall,
    },
    notes: {
      strengths,
      improvements,
      perDimension: [clarity, emotional, ctaStrength, relevance].map((d) => ({
        dimension: d.dimension,
        note: d.note,
      })),
    },
  };
}

interface DimensionAssessment {
  dimension: string;
  score: number;
  note: string;
}

function scoreClarity(v: VariantFields): DimensionAssessment {
  const wordCount = wordsOf(v.primaryText).length;
  const sentences = v.primaryText
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const avgSentenceLen =
    sentences.length > 0 ? wordCount / sentences.length : wordCount;

  let score = 100;
  const notes: string[] = [];

  if (wordCount < 10) {
    score -= 30;
    notes.push('primary text very short; reader gets little context');
  } else if (wordCount > 200) {
    score -= 25;
    notes.push('primary text long; trim to <150 words for ad placements');
  } else if (wordCount > 150) {
    score -= 10;
    notes.push('primary text on the long side');
  }

  if (avgSentenceLen > 28) {
    score -= 15;
    notes.push('sentences too long; aim for under 20 words on average');
  }
  if (v.headline.length > 60) {
    score -= 15;
    notes.push('headline too long; Meta truncates beyond ~40 chars');
  } else if (v.headline.length < 6) {
    score -= 15;
    notes.push('headline too short to communicate value');
  }

  score = clamp(score);
  return {
    dimension: 'clarity',
    score,
    note: notes.length > 0 ? notes.join('; ') : 'length and structure are well calibrated',
  };
}

function scoreEmotionalAppeal(v: VariantFields): DimensionAssessment {
  const text = `${v.primaryText} ${v.headline} ${v.description ?? ''}`.toLowerCase();
  const matches = EMOTIONAL_WORDS.filter((w) => text.includes(w)).length;
  const urgencyMatches = URGENCY_WORDS.filter((w) => text.includes(w)).length;
  const exclamations = (text.match(/!/g) ?? []).length;
  const questions = (text.match(/\?/g) ?? []).length;

  let score = 35;
  score += Math.min(matches * 12, 36);
  score += Math.min(urgencyMatches * 7, 14);
  score += Math.min(exclamations * 4, 8);
  score += Math.min(questions * 4, 8);

  score = clamp(score);
  const notes: string[] = [];
  if (matches === 0 && urgencyMatches === 0 && exclamations === 0 && questions === 0) {
    notes.push('no emotional or sensory hooks detected');
  }
  if (exclamations > 4) notes.push('exclamation marks may feel spammy');

  return {
    dimension: 'emotionalAppeal',
    score,
    note:
      notes.length > 0
        ? notes.join('; ')
        : `${matches} emotional + ${urgencyMatches} urgency cues found`,
  };
}

function scoreCtaStrength(v: VariantFields): DimensionAssessment {
  const ctaLower = v.cta.trim().toLowerCase();
  const firstWord = ctaLower.split(/\s+/)[0] ?? '';
  const hasStrongVerb = STRONG_CTA_VERBS.includes(firstWord);
  const isWeak = WEAK_CTA_PHRASES.some((w) => ctaLower === w);

  let score = 50;
  if (hasStrongVerb) score += 30;
  if (isWeak) score -= 30;
  if (v.cta.length > 24) score -= 15;
  if (v.cta.length < 2) score -= 30;

  score = clamp(score);
  const reason = isWeak
    ? `CTA "${v.cta}" is generic — use an action verb that matches the goal`
    : hasStrongVerb
      ? `strong action verb "${firstWord}" leads the CTA`
      : `CTA "${v.cta}" lacks a clear imperative verb`;
  return { dimension: 'ctaStrength', score, note: reason };
}

function scoreRelevance(
  v: VariantFields,
  brief: CopyBrief | null,
): DimensionAssessment {
  if (!brief) {
    return {
      dimension: 'relevance',
      score: 60,
      note: 'no brief supplied; scored on structural completeness only',
    };
  }
  const parsed = parseBrief(brief);
  const text = `${v.primaryText} ${v.headline} ${v.description ?? ''}`.toLowerCase();

  let score = 30;
  let mentionedBenefits = 0;
  for (const b of parsed.keyBenefits) {
    if (containsLoose(text, b)) mentionedBenefits += 1;
  }
  if (parsed.keyBenefits.length > 0) {
    score += Math.round((mentionedBenefits / parsed.keyBenefits.length) * 35);
  } else {
    score += 17;
  }

  if (brief.audience && containsLoose(text, brief.audience)) score += 15;
  if (brief.product && containsLoose(text, brief.product)) score += 10;

  let forbiddenHits = 0;
  for (const w of parsed.forbiddenWords) {
    if (w && containsLoose(text, w)) forbiddenHits += 1;
  }
  score -= forbiddenHits * 25;

  score = clamp(score);
  const notes: string[] = [];
  notes.push(
    `${mentionedBenefits}/${parsed.keyBenefits.length} key benefits referenced`,
  );
  if (brief.audience) {
    notes.push(
      containsLoose(text, brief.audience)
        ? `audience "${brief.audience}" is named`
        : `audience "${brief.audience}" not referenced`,
    );
  }
  if (forbiddenHits > 0) {
    notes.push(`${forbiddenHits} forbidden term(s) detected — fix before approving`);
  }

  return { dimension: 'relevance', score, note: notes.join('; ') };
}

function containsLoose(haystack: string, needle: string): boolean {
  if (!needle) return false;
  return haystack.includes(needle.trim().toLowerCase());
}

function wordsOf(s: string): string[] {
  return s.trim().split(/\s+/).filter(Boolean);
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function round(n: number): number {
  return Math.round(n);
}
