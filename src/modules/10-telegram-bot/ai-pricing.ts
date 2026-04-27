/**
 * @deprecated Import dari `../00-foundation/index.js` saja.
 *
 * File ini sengaja dipertahankan sebagai thin re-export selama
 * transition window setelah pricing logic dipindah ke
 * `00-foundation/pricing.ts` (April 2026). Modul lain (mis.
 * 06-copywriting-lab) tidak boleh lagi import dari sini.
 */

export {
  MODEL_PRICING,
  pricingFor,
  computeCostUsd,
  usdToIdrApprox,
  type ModelPricing,
  type UsageBreakdown,
} from '../00-foundation/pricing.js';
