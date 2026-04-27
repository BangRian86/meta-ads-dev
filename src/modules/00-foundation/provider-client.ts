/**
 * 00-foundation provider-client — base class untuk HTTP wrapper
 * external providers (Meta Graph, KIE.ai, Google Sheets, dll).
 *
 * SCOPE V1 (saat ini):
 * - Sediakan `request()` helper yang batch-aware: lakukan fetch, parse
 *   JSON, panggil error-mapper kalau gagal, dan dispatch ke audit/log.
 * - Sediakan retry policy minimal (retry-after honoring 429 + 5xx exponential).
 *
 * SCOPE V2 (TODO — belum di-pakai semua module):
 * - Provider-specific subclass (MetaProviderClient, KieProviderClient)
 *   yang inject base URL + auth header otomatis.
 * - Per-provider rate limit budgeting via job-dispatcher integration.
 *
 * Right now legacy modules (01-manage-campaigns, 03-start-stop-ads,
 * dll) PUNYA HTTP wrapper masing-masing — wrapper-nya tidak forced
 * di-migrate ke sini. Module baru SANGAT DIDORONG pakai class ini biar
 * kelak auditing + retry seragam.
 */

import { logger } from './logger.js';
import {
  mapHttpFailure,
  mapMetaError,
  type MappedMetaError,
} from './error-mapper.js';

export interface ProviderRequestInit {
  url: URL | string;
  method: 'GET' | 'POST' | 'DELETE' | 'PATCH' | 'PUT';
  /** application/x-www-form-urlencoded body (Meta) atau JSON (modern). */
  body?: URLSearchParams | string | Record<string, unknown>;
  headers?: Record<string, string>;
  /** Tag untuk log identification. Tidak di-stringify ke wire. */
  endpointTag: string;
  /** Per-call retry budget. Default 0 (no retry) — caller decide. */
  maxRetries?: number;
}

export interface ProviderResponse<T = unknown> {
  status: number;
  ok: boolean;
  payload: T | null;
  /** Mapped error kalau !ok dan response punya error body. */
  error: MappedMetaError | null;
  /** Wallclock duration in ms — caller boleh log ke audit. */
  durationMs: number;
}

export class ProviderClient {
  constructor(public readonly providerName: string) {}

  async request<T = unknown>(
    init: ProviderRequestInit,
  ): Promise<ProviderResponse<T>> {
    const url = init.url instanceof URL ? init.url : new URL(init.url);
    const headers = { ...(init.headers ?? {}) };

    // BodyInit type tidak ter-export di lib ES2022 default — pakai union
    // explicit dari shape yang kita kirim ke fetch.
    let body: URLSearchParams | string | undefined;
    if (init.body instanceof URLSearchParams) {
      body = init.body;
    } else if (typeof init.body === 'string') {
      body = init.body;
    } else if (init.body && typeof init.body === 'object') {
      body = JSON.stringify(init.body);
      if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
    }

    const maxRetries = init.maxRetries ?? 0;
    let attempt = 0;
    let lastErr: ProviderResponse<T> | null = null;
    while (attempt <= maxRetries) {
      const start = Date.now();
      let status = 0;
      let payload: unknown = null;
      try {
        const res = await fetch(url, { method: init.method, headers, ...(body !== undefined ? { body } : {}) });
        status = res.status;
        payload = await res.json().catch(() => null);
        const durationMs = Date.now() - start;

        if (res.ok) {
          return {
            status,
            ok: true,
            payload: payload as T,
            error: null,
            durationMs,
          };
        }

        const mapped = payload
          ? mapMetaError(payload)
          : mapHttpFailure(status, res.statusText, payload);

        // Retry only on transient (429 + 5xx); other errors bail immediately.
        if ((status === 429 || status >= 500) && attempt < maxRetries) {
          const backoffMs = Math.min(1000 * 2 ** attempt, 8000);
          logger.warn(
            { provider: this.providerName, endpoint: init.endpointTag, status, attempt, backoffMs },
            'provider transient error — retrying',
          );
          await sleep(backoffMs);
          attempt += 1;
          continue;
        }

        lastErr = {
          status,
          ok: false,
          payload: payload as T,
          error: mapped,
          durationMs,
        };
        return lastErr;
      } catch (err) {
        const durationMs = Date.now() - start;
        logger.error(
          { err, provider: this.providerName, endpoint: init.endpointTag, attempt },
          'provider network error',
        );
        if (attempt < maxRetries) {
          const backoffMs = Math.min(1000 * 2 ** attempt, 8000);
          await sleep(backoffMs);
          attempt += 1;
          continue;
        }
        return {
          status: 0,
          ok: false,
          payload: null,
          error: null,
          durationMs,
        };
      }
    }
    // Unreachable but TypeScript wants explicit return.
    return lastErr ?? {
      status: 0,
      ok: false,
      payload: null,
      error: null,
      durationMs: 0,
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
