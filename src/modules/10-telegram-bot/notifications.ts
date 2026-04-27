/**
 * @deprecated Import dari `../00-foundation/index.js` saja.
 *
 * File ini sengaja dipertahankan sebagai thin re-export selama
 * transition window setelah `notifyOwner` dipindah ke
 * `00-foundation/notifications.ts` (April 2026) untuk break circular
 * dependency 11→10, 12→10.
 */

export {
  notifyOwner,
  escapeMd,
  type NotifyOptions,
} from '../00-foundation/notifications.js';
