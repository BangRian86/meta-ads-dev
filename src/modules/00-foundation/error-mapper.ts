/**
 * 00-foundation error-mapper — map raw Meta API responses ke shape
 * normalized (code, kind, message, requiresTokenReplacement) supaya
 * call-site nggak parse string error mentah.
 *
 * Re-export dari `src/lib/error-mapper.ts`. Provider baru (KIE.ai,
 * TikTok, dst.) bisa register mapper sendiri kalau API shape-nya beda
 * — sementara ini scope cuma Meta.
 */
export { mapMetaError, mapHttpFailure } from '../../lib/error-mapper.js';
export type { MappedMetaError } from '../../lib/error-mapper.js';
