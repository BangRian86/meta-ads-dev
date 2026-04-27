import type { Channel } from './benchmarks.js';

export type Bucket = 'leads' | 'traffic' | 'awareness';

export interface ChannelInfo {
  /** Top-level section heading in the report. */
  bucket: Bucket;
  /** Per-campaign benchmark channel (drives ✅/⚠️ thresholds). */
  channel: Channel;
}

const SALES_LIKE = new Set([
  'OUTCOME_SALES',
  // Older API names — defensive in case sync hits a legacy snapshot.
  'CONVERSIONS',
]);

const ENGAGEMENT_LIKE = new Set([
  'OUTCOME_LEADS',
  'OUTCOME_ENGAGEMENT',
  // Older API names.
  'LEAD_GENERATION',
  'MESSAGES',
]);

/** Pattern di nama campaign yang juga menandakan sales — dipakai bahkan
 *  kalau objective Meta-nya bukan OUTCOME_SALES (mis. campaign lama yang
 *  named "SALES PURCHASE" tapi objective masih LEAD_GENERATION). */
const SALES_NAME_PATTERN = /SALES\s+PURCHASE/i;

const TRAFFIC_LIKE = new Set([
  'OUTCOME_TRAFFIC',
  'LINK_CLICKS',
]);

const AWARENESS_LIKE = new Set([
  'OUTCOME_AWARENESS',
  'BRAND_AWARENESS',
  'REACH',
]);

const WHATSAPP_DEST = new Set(['WHATSAPP', 'WHATSAPP_BUSINESS', 'MESSENGER', 'INSTAGRAM_DIRECT', 'ON_AD']);
const WEBSITE_DEST = new Set(['WEBSITE', 'OFF_AD', 'ONSITE_TEMPORARY_FLOW']);

/**
 * Maps (objective, destinationType, campaignName) → bucket + benchmark channel.
 * Returns null when the campaign should not appear in the progress report
 * (e.g. unknown objective).
 *
 * Sales detection (priority — dicek SEBELUM leads):
 *  - objective === OUTCOME_SALES (atau legacy CONVERSIONS), ATAU
 *  - campaign name match /SALES PURCHASE/i
 *  Sales tetap di-bucket 'leads' supaya muncul di section yang sama, tapi
 *  pakai threshold tier 'sales' yang lebih tinggi (lihat benchmarks.ts).
 *
 * Destination-type defaulting:
 *  - if destination is unknown, leads go under leads_wa (operator default
 *    for Basmalah/Aqiqah is WA messaging) and traffic goes under traffic_lp.
 *
 * `campaignName` opsional untuk backward-compat — caller lama yang tidak
 * passes name akan tetap dapat klasifikasi yang benar berdasarkan objective.
 */
export function classifyCampaign(
  objective: string | null | undefined,
  destinationType: string | null | undefined,
  campaignName?: string | null | undefined,
): ChannelInfo | null {
  if (!objective) return null;
  const obj = objective.toUpperCase();
  const dest = (destinationType ?? '').toUpperCase();
  const name = campaignName ?? '';

  // Sales detection — dicek paling awal supaya OUTCOME_SALES tidak ke-match
  // ke ENGAGEMENT_LIKE (yang lama mengandung OUTCOME_SALES).
  if (SALES_LIKE.has(obj) || SALES_NAME_PATTERN.test(name)) {
    return { bucket: 'leads', channel: 'sales' };
  }

  if (AWARENESS_LIKE.has(obj)) {
    return { bucket: 'awareness', channel: 'awareness' };
  }
  if (TRAFFIC_LIKE.has(obj)) {
    if (WHATSAPP_DEST.has(dest)) return { bucket: 'traffic', channel: 'traffic_wa' };
    return { bucket: 'traffic', channel: 'traffic_lp' };
  }
  if (ENGAGEMENT_LIKE.has(obj)) {
    if (WEBSITE_DEST.has(dest)) return { bucket: 'leads', channel: 'leads_lp' };
    return { bucket: 'leads', channel: 'leads_wa' };
  }
  return null;
}
