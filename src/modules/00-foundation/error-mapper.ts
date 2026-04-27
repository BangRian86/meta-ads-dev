/**
 * 00-foundation error-mapper — normalize Meta Graph API errors ke shape
 * consistent (code, kind, message, requiresTokenReplacement) supaya
 * call-site nggak parse string error mentah.
 *
 * Sebelumnya implementation di `src/lib/error-mapper.ts` sebagai legacy
 * top-level lib. Dipindah ke foundation April 2026 saat src/lib/*
 * dihapus.
 *
 * Reference: https://developers.facebook.com/docs/graph-api/guides/error-handling
 */

export type MetaErrorKind =
  | 'auth'
  | 'rate_limit'
  | 'permission'
  | 'validation'
  | 'transient'
  | 'server'
  | 'unknown';

export interface MappedMetaError {
  kind: MetaErrorKind;
  code: string;
  subcode?: string;
  message: string;
  fbtraceId?: string;
  /** True if the same call may succeed if retried later. */
  retryable: boolean;
  /** True if this requires the owner to replace the token. */
  requiresTokenReplacement: boolean;
  /** Original error payload from Meta, for forensic logging. */
  raw: unknown;
}

interface RawMetaError {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  error_user_title?: string;
  error_user_msg?: string;
  fbtrace_id?: string;
  is_transient?: boolean;
}

// OAuth / auth-related codes — owner must re-issue token.
const AUTH_CODES = new Set<number>([102, 190, 458, 459, 460, 463, 464, 467]);

// Rate limiting / throttling.
const RATE_LIMIT_CODES = new Set<number>([4, 17, 32, 613, 80004]);

// Permission / capability codes — token works but lacks scope.
const PERMISSION_CODES = new Set<number>([10, 200, 294, 299]);

export function mapMetaError(input: unknown): MappedMetaError {
  const err = extractError(input);

  if (!err) {
    return {
      kind: 'unknown',
      code: 'no_error_payload',
      message: 'No error payload available',
      retryable: false,
      requiresTokenReplacement: false,
      raw: input,
    };
  }

  const code = typeof err.code === 'number' ? err.code : -1;
  const subcode =
    typeof err.error_subcode === 'number' ? String(err.error_subcode) : undefined;
  const message = err.error_user_msg ?? err.message ?? 'Unknown Meta API error';
  const fbtraceId = err.fbtrace_id;

  const base = {
    code: String(code),
    subcode,
    message,
    fbtraceId,
    raw: input,
  } as const;

  if (AUTH_CODES.has(code)) {
    return {
      ...base,
      kind: 'auth',
      retryable: false,
      requiresTokenReplacement: true,
    };
  }

  if (RATE_LIMIT_CODES.has(code)) {
    return { ...base, kind: 'rate_limit', retryable: true, requiresTokenReplacement: false };
  }

  if (PERMISSION_CODES.has(code)) {
    return { ...base, kind: 'permission', retryable: false, requiresTokenReplacement: false };
  }

  if (err.is_transient || code === 1 || code === 2) {
    return { ...base, kind: 'transient', retryable: true, requiresTokenReplacement: false };
  }

  if (code >= 100 && code < 200) {
    return { ...base, kind: 'validation', retryable: false, requiresTokenReplacement: false };
  }

  if (code >= 500 && code < 600) {
    return { ...base, kind: 'server', retryable: true, requiresTokenReplacement: false };
  }

  return { ...base, kind: 'unknown', retryable: false, requiresTokenReplacement: false };
}

/**
 * Maps an HTTP-level failure (no JSON body, network drop, etc.) to the same shape.
 */
export function mapHttpFailure(status: number, message: string, raw?: unknown): MappedMetaError {
  if (status === 401 || status === 403) {
    return {
      kind: 'auth',
      code: `http_${status}`,
      message,
      retryable: false,
      requiresTokenReplacement: true,
      raw,
    };
  }
  if (status === 429) {
    return {
      kind: 'rate_limit',
      code: `http_${status}`,
      message,
      retryable: true,
      requiresTokenReplacement: false,
      raw,
    };
  }
  if (status >= 500) {
    return {
      kind: 'server',
      code: `http_${status}`,
      message,
      retryable: true,
      requiresTokenReplacement: false,
      raw,
    };
  }
  return {
    kind: 'unknown',
    code: `http_${status}`,
    message,
    retryable: false,
    requiresTokenReplacement: false,
    raw,
  };
}

function extractError(input: unknown): RawMetaError | null {
  if (!input || typeof input !== 'object') return null;
  const obj = input as Record<string, unknown>;
  if (obj.error && typeof obj.error === 'object') {
    return obj.error as RawMetaError;
  }
  if ('code' in obj || 'message' in obj) {
    return obj as RawMetaError;
  }
  return null;
}
