/**
 * 00-foundation config — re-export environment configuration.
 *
 * Single source of truth: `src/config/env.ts` (Zod-validated env).
 * Wrapped here as foundation layer so module-level code bisa import via
 * `00-foundation` tanpa traverse ke `../../config`.
 */
export { config } from '../../config/env.js';
