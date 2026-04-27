import type { DateRange } from '../02-ads-analysis/index.js';
import {
  buildCampaignRoasForRange,
  type CampaignRoasRow,
} from '../15-closing-tracker/index.js';
import { detectCampaignType } from './detect-campaign-type.js';
import {
  getThreshold,
  MIN_SPEND_IDR,
  type Business,
  type CampaignType,
  type ThresholdConfig,
} from './threshold-config.js';

export type AlertWindow = 'daily' | 'weekly' | 'monthly';
export type AlertSeverity = 'critical' | 'warning' | 'ok';

export interface CampaignAlert {
  campaign_id: string;
  campaign_name: string;
  business: Business;
  campaign_type: CampaignType;
  window: AlertWindow;
  spend: number;
  revenue: number;
  roas: number;
  severity: AlertSeverity;
  threshold_critical: number;
  threshold_warning: number;
}

/**
 * Hasil evaluasi: alert yang perlu di-action (critical+warning) +
 * counter buat baris ringkasan ("✅ Yang masih aman: N campaign")
 * dan buat keputusan silent-when-no-alerts di cron.
 */
export interface EvaluationResult {
  business: Business;
  window: AlertWindow;
  range: DateRange;
  /** Campaign yang ROAS-nya di atas warning threshold (sehat). Dihitung
   *  doang, nggak dirender per-campaign biar message tetap ringkas. */
  healthyCount: number;
  /** Campaign yang di-skip karena spend < MIN_SPEND_IDR. Dihitung supaya
   *  operator nggak bingung kalau jumlah alert kelihatan kecil — sebagian
   *  besar mungkin ke-filter karena spend masih kecil. */
  belowMinSpendCount: number;
  /** Campaign yang account-nya belum ada revenue di Sheets sama sekali —
   *  ROAS nggak bisa dihitung jadi nggak bisa di-alert. */
  noBusinessCount: number;
  /** Critical + warning saja. Sudah di-sort: critical duluan, dalam tiap
   *  group sort by ROAS ascending (worst first). */
  alerts: CampaignAlert[];
}

const WINDOW_DAYS: Record<AlertWindow, number> = {
  daily: 1,
  weekly: 7,
  monthly: 30,
};

function rangeForWindow(window: AlertWindow): DateRange {
  const days = WINDOW_DAYS[window];
  const until = isoDateOffset(0);
  const since = isoDateOffset(-(days - 1));
  return { since, until };
}

function isoDateOffset(daysFromToday: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromToday);
  return d.toISOString().slice(0, 10);
}

/**
 * Evaluasi alert ROAS untuk satu kombinasi business+window. Skip campaign
 * yang spend-nya di bawah MIN_SPEND_IDR (terlalu kecil — anggap noise) dan
 * skip account yang belum ada revenue di Sheets (ROAS nggak bisa dihitung).
 */
export async function evaluateAlerts(
  business: Business,
  window: AlertWindow,
): Promise<EvaluationResult> {
  const range = rangeForWindow(window);
  const allRows = await buildCampaignRoasForRange(range);

  const alerts: CampaignAlert[] = [];
  let healthyCount = 0;
  let belowMinSpendCount = 0;
  let noBusinessCount = 0;

  for (const row of allRows) {
    if (row.business !== business) continue;
    if (row.spendIdr < MIN_SPEND_IDR) {
      belowMinSpendCount += 1;
      continue;
    }
    // Belum ada revenue dari Sheets → ROAS pasti 0 untuk semua campaign
    // di account ini, jadi alert nggak meaningful. Skip dan hitung di
    // noBusinessCount supaya operator tahu kenapa list-nya kosong.
    if (row.estimatedRevenueIdr === 0) {
      noBusinessCount += 1;
      continue;
    }
    const type = detectCampaignType(row.campaignName);
    const threshold = getThreshold(business, type);
    const severity = severityFor(row.roas, threshold);
    if (severity === 'ok') {
      healthyCount += 1;
      continue;
    }
    alerts.push({
      campaign_id: row.campaignId,
      campaign_name: row.campaignName,
      business,
      campaign_type: type,
      window,
      spend: row.spendIdr,
      revenue: row.estimatedRevenueIdr,
      roas: row.roas,
      severity,
      threshold_critical: threshold.roas_critical,
      threshold_warning: threshold.roas_warning,
    });
  }

  // Urutan: critical duluan, baru warning. Dalam tiap group, ROAS paling
  // rendah (paling parah) di atas — biar operator langsung ketemu yang
  // urgent tanpa perlu scroll.
  alerts.sort((a, b) => {
    const severityOrder = (s: AlertSeverity): number =>
      s === 'critical' ? 0 : s === 'warning' ? 1 : 2;
    const cmp = severityOrder(a.severity) - severityOrder(b.severity);
    if (cmp !== 0) return cmp;
    return a.roas - b.roas;
  });

  return {
    business,
    window,
    range,
    healthyCount,
    belowMinSpendCount,
    noBusinessCount,
    alerts,
  };
}

function severityFor(
  roas: number,
  threshold: ThresholdConfig,
): AlertSeverity {
  if (roas < threshold.roas_critical) return 'critical';
  if (roas < threshold.roas_warning) return 'warning';
  return 'ok';
}
