import { appConfig as config } from '../00-foundation/index.js';
import { logger } from '../00-foundation/index.js';
import { db } from '../00-foundation/index.js';
import { metaRequestLogs } from '../../db/schema/index.js';
import {
  KieCredentialError,
  markKieCredentialFailure,
  recordValidatedAt,
  requireActiveKieCredential,
} from './kie-credentials.js';

export type KieTaskStatus =
  | 'pending'
  | 'processing'
  | 'success'
  | 'failed';

export interface KieSubmitOptions {
  prompt: string;
  size?: string;
  nVariants?: number;
  isEnhance?: boolean;
  /** When provided, KIE will POST result to this URL on completion. */
  callBackUrl?: string;
  filesUrl?: string[];
  extra?: Record<string, unknown>;
}

export interface KieSubmitResult {
  taskId: string;
  raw: unknown;
}

export interface KieTaskDetail {
  taskId: string;
  status: KieTaskStatus;
  resultUrls: string[];
  errorMessage: string | null;
  raw: unknown;
}

// Migrated 2026-04-26 dari /api/v1/gpt4o-image/* (yang return "Internal
// Error" 4/4 attempt — backend GPT-4o image gen-nya KIE memang broken
// untuk akun ini) ke /api/v1/playground/* dengan model selection.
//
// Playground endpoint terbukti reliable: nano-banana (Google Imagen 4)
// return image dalam ~7 detik.
const ENDPOINT_GENERATE = '/api/v1/playground/createTask';
const ENDPOINT_DETAILS = '/api/v1/playground/recordInfo';
/** Default playground model. Bisa di-override via opts.extra.model. */
const DEFAULT_MODEL = 'google/nano-banana';

export async function submitImageTask(
  connectionId: string,
  opts: KieSubmitOptions,
): Promise<KieSubmitResult> {
  const cred = await requireActiveKieCredential();
  const url = new URL(`${config.kie.baseUrl}${ENDPOINT_GENERATE}`);
  // Playground request shape: { model, input: { ... }, callBackUrl? }.
  // `opts.extra.model` boleh override default kalau caller mau model lain
  // (mis. 'flux-pro/v1.1', 'recraft/v3'). Field-field GPT-4o-style yang
  // dipakai callsite lama (size, nVariants, isEnhance, filesUrl) di-map
  // ke playground input shape.
  const extra = (opts.extra ?? {}) as Record<string, unknown>;
  const model =
    typeof extra.model === 'string' && extra.model.length > 0
      ? extra.model
      : DEFAULT_MODEL;
  const input: Record<string, unknown> = {
    prompt: opts.prompt,
    output_format: 'png',
    ...(opts.size ? { image_size: opts.size } : {}),
    ...(opts.nVariants ? { num_outputs: opts.nVariants } : {}),
    ...(opts.filesUrl && opts.filesUrl.length > 0
      ? { image_urls: opts.filesUrl }
      : {}),
  };
  // Forward extra fields dari caller, kecuali `model` yang sudah di-pop.
  for (const [k, v] of Object.entries(extra)) {
    if (k === 'model') continue;
    input[k] = v;
  }
  const body: Record<string, unknown> = {
    model,
    input,
    ...(opts.callBackUrl ? { callBackUrl: opts.callBackUrl } : {}),
  };

  const start = Date.now();
  let httpStatus = 0;
  let payload: unknown = null;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cred.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    httpStatus = res.status;
    payload = await res.json().catch(() => null);

    const failure = detectKieFailure(httpStatus, payload);
    if (failure) {
      await logKieRequest(connectionId, 'POST', ENDPOINT_GENERATE, sanitize(body), httpStatus, payload, failure.errorCode, Date.now() - start);
      if (failure.credentialFailure) {
        await markKieCredentialFailure(cred.id, failure.credentialFailure, failure.message);
        throw new KieCredentialError(failure.credentialFailure, cred.id, failure.message);
      }
      throw new Error(`KIE submit failed: ${failure.errorCode} ${failure.message}`);
    }

    await logKieRequest(connectionId, 'POST', ENDPOINT_GENERATE, sanitize(body), httpStatus, payload, null, Date.now() - start);
    await recordValidatedAt(cred.id);

    const taskId = extractTaskId(payload);
    if (!taskId) throw new Error('KIE submit response missing data.taskId');
    return { taskId, raw: payload };
  } catch (err) {
    if (err instanceof KieCredentialError) throw err;
    if (httpStatus === 0) {
      logger.error({ err, opts: sanitize(body) }, 'Network error submitting KIE task');
      await logKieRequest(
        connectionId,
        'POST',
        ENDPOINT_GENERATE,
        sanitize(body),
        0,
        payload,
        null,
        Date.now() - start,
        err instanceof Error ? err.message : String(err),
      );
    }
    throw err;
  }
}

export async function fetchTaskDetail(
  connectionId: string | null,
  providerTaskId: string,
): Promise<KieTaskDetail> {
  const cred = await requireActiveKieCredential();
  const url = new URL(`${config.kie.baseUrl}${ENDPOINT_DETAILS}`);
  url.searchParams.set('taskId', providerTaskId);

  const start = Date.now();
  let httpStatus = 0;
  let payload: unknown = null;

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${cred.apiKey}` },
    });
    httpStatus = res.status;
    payload = await res.json().catch(() => null);

    const failure = detectKieFailure(httpStatus, payload);
    if (failure) {
      await logKieRequest(connectionId, 'GET', ENDPOINT_DETAILS, { taskId: providerTaskId }, httpStatus, payload, failure.errorCode, Date.now() - start);
      if (failure.credentialFailure) {
        await markKieCredentialFailure(cred.id, failure.credentialFailure, failure.message);
        throw new KieCredentialError(failure.credentialFailure, cred.id, failure.message);
      }
      throw new Error(`KIE detail fetch failed: ${failure.errorCode} ${failure.message}`);
    }

    await logKieRequest(connectionId, 'GET', ENDPOINT_DETAILS, { taskId: providerTaskId }, httpStatus, payload, null, Date.now() - start);
    return parseDetail(payload, providerTaskId);
  } catch (err) {
    if (err instanceof KieCredentialError) throw err;
    if (httpStatus === 0) {
      logger.error({ err, providerTaskId }, 'Network error fetching KIE task detail');
      await logKieRequest(
        connectionId,
        'GET',
        ENDPOINT_DETAILS,
        { taskId: providerTaskId },
        0,
        payload,
        null,
        Date.now() - start,
        err instanceof Error ? err.message : String(err),
      );
    }
    throw err;
  }
}

interface KieFailure {
  credentialFailure: 'invalid_key' | 'credits_exhausted' | null;
  errorCode: string;
  message: string;
}

function detectKieFailure(httpStatus: number, payload: unknown): KieFailure | null {
  // KIE returns business errors inside a 200 with `code != 200` as well as via HTTP status.
  if (httpStatus === 401) {
    return { credentialFailure: 'invalid_key', errorCode: 'http_401', message: 'Unauthorized' };
  }
  if (httpStatus === 402) {
    return {
      credentialFailure: 'credits_exhausted',
      errorCode: 'http_402',
      message: 'Insufficient credits',
    };
  }
  if (httpStatus >= 400) {
    const msg = readMessage(payload) ?? `HTTP ${httpStatus}`;
    return { credentialFailure: null, errorCode: `http_${httpStatus}`, message: msg };
  }
  if (payload && typeof payload === 'object') {
    const obj = payload as { code?: unknown; msg?: unknown };
    const code = typeof obj.code === 'number' ? obj.code : null;
    if (code != null && code !== 200) {
      const msg = typeof obj.msg === 'string' ? obj.msg : 'KIE error';
      if (code === 401) {
        return { credentialFailure: 'invalid_key', errorCode: `kie_${code}`, message: msg };
      }
      if (code === 402 || /credit/i.test(msg)) {
        return { credentialFailure: 'credits_exhausted', errorCode: `kie_${code}`, message: msg };
      }
      return { credentialFailure: null, errorCode: `kie_${code}`, message: msg };
    }
  }
  return null;
}

function extractTaskId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const data = (payload as { data?: unknown }).data;
  if (!data || typeof data !== 'object') return null;
  const id = (data as { taskId?: unknown }).taskId;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

function parseDetail(payload: unknown, providerTaskId: string): KieTaskDetail {
  const data =
    payload && typeof payload === 'object' && (payload as { data?: unknown }).data
      ? ((payload as { data: unknown }).data as Record<string, unknown>)
      : {};
  // Playground response: `state` ('success' / 'fail' / 'queueing' /
  // 'generating'). Old GPT-4o response: `status` ('SUCCESS' / 'GENERATE_FAILED'
  // / 'GENERATING'). Dukung dua-duanya supaya row lama di content_assets
  // yang masih reference taskId GPT-4o tetap bisa di-parse.
  const rawState = typeof data.state === 'string' ? data.state.toUpperCase() : '';
  const rawStatus = typeof data.status === 'string' ? data.status.toUpperCase() : '';
  const status = mapStatus(rawState || rawStatus);
  const resultUrls = pluckResultUrls(data);
  // Playground pakai `failMsg`, GPT-4o pakai `errorMsg`. Cek dua-duanya.
  const errorMessage =
    (typeof data.failMsg === 'string' && data.failMsg.length > 0
      ? data.failMsg
      : null) ??
    (typeof data.errorMsg === 'string' && data.errorMsg.length > 0
      ? data.errorMsg
      : null) ??
    (typeof data.errorMessage === 'string' && data.errorMessage.length > 0
      ? data.errorMessage
      : null);
  return {
    taskId: providerTaskId,
    status,
    resultUrls,
    errorMessage,
    raw: payload,
  };
}

function mapStatus(s: string): KieTaskStatus {
  switch (s) {
    // Playground states (UPPERCASED).
    case 'SUCCESS':
      return 'success';
    case 'FAIL':
      return 'failed';
    case 'QUEUEING':
      return 'pending';
    case 'GENERATING':
      return 'processing';
    // Legacy GPT-4o statuses — keep working for old rows.
    case 'PROCESSING':
      return 'processing';
    case 'GENERATE_FAILED':
    case 'CREATE_TASK_FAILED':
    case 'FAILED':
      return 'failed';
    case 'WAITING':
    case 'QUEUED':
    case 'PENDING':
    case '':
      return 'pending';
    default:
      return 'processing';
  }
}

export function pluckResultUrls(data: Record<string, unknown>): string[] {
  // Playground shape: data.resultJson adalah STRING JSON yang berisi
  // { resultUrls: [...] }. Parse defensively.
  const resultJsonRaw = data.resultJson;
  if (typeof resultJsonRaw === 'string' && resultJsonRaw.trim()) {
    try {
      const parsed = JSON.parse(resultJsonRaw) as { resultUrls?: unknown };
      if (Array.isArray(parsed.resultUrls)) {
        return parsed.resultUrls.filter((u): u is string => typeof u === 'string');
      }
    } catch {
      // Fall through to other shapes.
    }
  }
  // Legacy GPT-4o shape: data.info.resultUrls or data.response.resultUrls.
  const fromInfo = (data.info as { resultUrls?: unknown } | undefined)?.resultUrls;
  if (Array.isArray(fromInfo)) {
    return fromInfo.filter((u): u is string => typeof u === 'string');
  }
  const fromResp = (data.response as { resultUrls?: unknown } | undefined)?.resultUrls;
  if (Array.isArray(fromResp)) {
    return fromResp.filter((u): u is string => typeof u === 'string');
  }
  return [];
}

function readMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const m = (payload as { msg?: unknown; message?: unknown }).msg ?? (payload as { message?: unknown }).message;
  return typeof m === 'string' ? m : null;
}

function sanitize(body: Record<string, unknown>): Record<string, unknown> {
  // Body has no API key; nothing to redact today, but stay explicit.
  return body;
}

async function logKieRequest(
  connectionId: string | null,
  method: string,
  endpoint: string,
  params: Record<string, unknown>,
  status: number,
  body: unknown,
  errorCode: string | null,
  durationMs: number,
  errorMessage?: string,
): Promise<void> {
  if (!connectionId) return; // meta_request_logs requires a connection id
  try {
    await db.insert(metaRequestLogs).values({
      connectionId,
      method,
      endpoint: `kie:${endpoint}`,
      requestParams: params as never,
      responseStatus: status,
      responseBody: (body ?? (errorMessage ? { error: errorMessage } : null)) as never,
      errorCode,
      errorSubcode: null,
      errorKind: errorCode ? 'kie' : null,
      durationMs,
    });
  } catch (err) {
    logger.error({ err }, 'Failed to write meta_request_logs row (kie)');
  }
}
