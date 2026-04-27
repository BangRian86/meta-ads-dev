/**
 * 00-foundation auth — re-export Meta connection auth manager.
 *
 * Konsolidasi single import path untuk Meta token auth (token validation,
 * connection lookup, invalidation). Implementation tetap di
 * `src/lib/auth-manager.ts` selama transition window — module lain bisa
 * pakai PATH MANA SAJA sambil migrasi gradual.
 *
 * NOTE: Telegram-user auth (isAllowedChat / isApprover) tetap di
 * `src/modules/10-telegram-bot/auth.ts` — itu concern berbeda
 * (chat/user-level), bukan provider auth.
 */
export {
  TokenInvalidError,
  requireActiveConnection,
  validateLive,
  markInvalid,
  replaceToken,
} from '../../lib/auth-manager.js';
