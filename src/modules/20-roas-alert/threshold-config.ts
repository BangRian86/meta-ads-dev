import type { BusinessKind } from '../13-sheets-integration/index.js';

/** Alias dari BusinessKind biar ngikutin vocabulary spec. Value-nya sama. */
export type Business = BusinessKind;
export type CampaignType = 'BOFU' | 'MOFU' | 'TOFU' | 'SALES' | 'DEFAULT';

export interface ThresholdConfig {
  business: Business;
  campaign_type: CampaignType;
  roas_critical: number;
  roas_warning: number;
}

/**
 * Threshold ROAS per bisnis × per stage funnel.
 *
 * `DEFAULT` dipakai sebagai fallback kalau nama campaign nggak match
 * keyword apapun (BOFU / MOFU / TOFU / SALES). Lihat detect-campaign-type.ts
 * untuk daftar keyword-nya.
 */
export const THRESHOLDS: ThresholdConfig[] = [
  // Threshold ROAS Aqiqah (AOV rendah, cycle cepat, conversion langsung).
  // Threshold lebih rendah karena harga aqiqah lebih murah & marginnya beda.
  { business: 'aqiqah', campaign_type: 'BOFU', roas_critical: 8, roas_warning: 12 },
  { business: 'aqiqah', campaign_type: 'MOFU', roas_critical: 6, roas_warning: 10 },
  { business: 'aqiqah', campaign_type: 'TOFU', roas_critical: 4, roas_warning: 7 },
  { business: 'aqiqah', campaign_type: 'SALES', roas_critical: 7, roas_warning: 10 },
  { business: 'aqiqah', campaign_type: 'DEFAULT', roas_critical: 7, roas_warning: 10 },
  // Threshold ROAS Basmalah Travel (AOV tinggi Rp 27,9jt, profit/jamaah Rp 1,5jt).
  // Break-even ROAS ≈ 18.6x. Di bawah angka ini = rugi atau margin tipis banget,
  // jadi threshold sengaja di-set tinggi (TOFU minimal 18, ideal di atas 25).
  { business: 'basmalah', campaign_type: 'BOFU', roas_critical: 30, roas_warning: 40 },
  { business: 'basmalah', campaign_type: 'MOFU', roas_critical: 25, roas_warning: 35 },
  { business: 'basmalah', campaign_type: 'TOFU', roas_critical: 18, roas_warning: 25 },
  { business: 'basmalah', campaign_type: 'SALES', roas_critical: 28, roas_warning: 38 },
  { business: 'basmalah', campaign_type: 'DEFAULT', roas_critical: 28, roas_warning: 38 },
];

/**
 * Cari threshold untuk kombinasi business+type. Kalau type yang diminta
 * nggak ada di config, fallback ke baris DEFAULT bisnis tersebut.
 *
 * Non-null assertion aman karena setiap business punya baris DEFAULT.
 */
export function getThreshold(
  business: Business,
  type: CampaignType,
): ThresholdConfig {
  return (
    THRESHOLDS.find(
      (t) => t.business === business && t.campaign_type === type,
    ) ??
    THRESHOLDS.find(
      (t) => t.business === business && t.campaign_type === 'DEFAULT',
    )!
  );
}

/**
 * Minimum spend (rupiah) supaya campaign masuk ranking atau alert.
 * Di bawah Rp 50.000 anggap belum signifikan — ROAS-nya cuma noise statistik
 * dan bikin alert false positive.
 */
export const MIN_SPEND_IDR = 50_000;
