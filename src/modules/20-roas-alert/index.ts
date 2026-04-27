/**
 * @deprecated 2026-04-26 (Tahap 2 rebuild).
 *
 * Module ini hitung ROAS pakai Meta API spend × proportional attribution
 * dari Sheets revenue → angka tidak akurat. Penggantinya:
 * `src/modules/30-sheets-reader/` yang baca semua data 100% dari Google
 * Sheets (no recalc).
 *
 * Cron lama (`/etc/cron.d/maa-roas-alerts`) sudah disable. Module masih
 * di-export buat /alerts deprecated handler di commands.ts (transition
 * window). Jangan dipakai untuk feature baru.
 */
export {
  THRESHOLDS,
  MIN_SPEND_IDR,
  getThreshold,
  type Business,
  type CampaignType,
  type ThresholdConfig,
} from './threshold-config.js';

export { detectCampaignType } from './detect-campaign-type.js';

export {
  evaluateAlerts,
  type AlertSeverity,
  type AlertWindow,
  type CampaignAlert,
  type EvaluationResult,
} from './alert-engine.js';

export {
  formatEvaluationResult,
  formatMultipleResults,
} from './formatter.js';
