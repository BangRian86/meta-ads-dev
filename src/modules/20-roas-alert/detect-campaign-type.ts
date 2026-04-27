import type { CampaignType } from './threshold-config.js';

/**
 * Tebak stage funnel sebuah campaign dari nama-nya, case-insensitive
 * substring match. Urutan check penting — acronym BOFU/MOFU/TOFU/SALES
 * dicek dulu, baru bentuk panjang. Kalau nggak match apapun → DEFAULT.
 *
 * Aturan match:
 *   BOFU  ← "BOFU" | "RETARGET" | "RT"
 *   MOFU  ← "MOFU" | "LOOKALIKE" | "LLA"
 *   TOFU  ← "TOFU" | "INTEREST" | "COLD"
 *   SALES ← "SALES" | "CONVERSION" | "CLOSING"
 *   lain  ← DEFAULT
 *
 * "RT" di-match sebagai whole-word (\bRT\b) — kalau substring biasa,
 * bakal bentrok sama kata "TARGET", "PURCHASE", "DEPARTURE", dll yang
 * kebetulan punya "rt" di dalamnya.
 */
export function detectCampaignType(campaignName: string): CampaignType {
  if (!campaignName) return 'DEFAULT';
  const upper = campaignName.toUpperCase();

  if (upper.includes('BOFU')) return 'BOFU';
  if (upper.includes('RETARGET')) return 'BOFU';
  if (/\bRT\b/.test(upper)) return 'BOFU';

  if (upper.includes('MOFU')) return 'MOFU';
  if (upper.includes('LOOKALIKE')) return 'MOFU';
  if (upper.includes('LLA')) return 'MOFU';

  if (upper.includes('TOFU')) return 'TOFU';
  if (upper.includes('INTEREST')) return 'TOFU';
  if (upper.includes('COLD')) return 'TOFU';

  if (upper.includes('SALES')) return 'SALES';
  if (upper.includes('CONVERSION')) return 'SALES';
  if (upper.includes('CLOSING')) return 'SALES';

  return 'DEFAULT';
}
