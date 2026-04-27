import { appConfig as config } from '../00-foundation/index.js';
import { logger } from '../00-foundation/index.js';
import {
  KieCredentialError,
  markKieCredentialFailure,
  recordValidatedAt,
  requireActiveKieCredential,
} from '../05-kie-image-generator/kie-credentials.js';
import type {
  VideoProvider,
  VideoSubmitOptions,
  VideoSubmitResult,
  VideoTaskDetail,
  VideoTaskStatus,
} from './provider.js';

/**
 * KIE.ai jobs API — Wan 2.7 video models.
 *
 * Catatan endpoint: KIE punya dua family API:
 *   - `/api/v1/playground/*` — image (nano-banana, dst).
 *   - `/api/v1/jobs/*`       — video & marketplace models (Wan, Veo, Kling).
 * Wan 2.7 ada di jobs family — bukan playground. Sumber:
 * https://docs.kie.ai/market/wan/2-7-text-to-video
 *
 * Models:
 *   - wan/2-7-text-to-video  → T2V
 *   - wan/2-7-image-to-video → I2V (perlu first_frame_url)
 *
 * Default: 720p, 10 detik (per requirement modul). Output mp4 (native).
 */
const ENDPOINT_GENERATE = '/api/v1/jobs/createTask';
const ENDPOINT_DETAILS = '/api/v1/jobs/recordInfo';

const MODEL_T2V = 'wan/2-7-text-to-video';
const MODEL_I2V = 'wan/2-7-image-to-video';

const DEFAULT_RESOLUTION = '720p';
const DEFAULT_DURATION_SEC = 10;
const DEFAULT_RATIO = '16:9';

class KieVideoProvider implements VideoProvider {
  readonly name = 'kie.jobs.wan-2-7';

  async submit(opts: VideoSubmitOptions): Promise<VideoSubmitResult> {
    const cred = await requireActiveKieCredential();
    const url = new URL(`${config.kie.baseUrl}${ENDPOINT_GENERATE}`);
    const model = opts.mode === 'image_to_video' ? MODEL_I2V : MODEL_T2V;

    const input: Record<string, unknown> = {
      prompt: opts.prompt,
      resolution: opts.resolution ?? DEFAULT_RESOLUTION,
      duration: opts.durationSec ?? DEFAULT_DURATION_SEC,
      ratio: opts.ratio ?? DEFAULT_RATIO,
    };
    if (opts.mode === 'image_to_video') {
      if (!opts.firstFrameUrl) {
        throw new Error('image_to_video mode requires firstFrameUrl');
      }
      input.first_frame_url = opts.firstFrameUrl;
    }
    for (const [k, v] of Object.entries(opts.extra ?? {})) input[k] = v;

    const body: Record<string, unknown> = { model, input };
    if (config.kie.callbackUrl) body.callBackUrl = config.kie.callbackUrl;

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
        await logKieRequest('POST', ENDPOINT_GENERATE, body, httpStatus, payload, failure.errorCode, Date.now() - start);
        if (failure.credentialFailure) {
          await markKieCredentialFailure(cred.id, failure.credentialFailure, failure.message);
          throw new KieCredentialError(failure.credentialFailure, cred.id, failure.message);
        }
        throw new Error(`KIE video submit failed: ${failure.errorCode} ${failure.message}`);
      }

      await logKieRequest('POST', ENDPOINT_GENERATE, body, httpStatus, payload, null, Date.now() - start);
      await recordValidatedAt(cred.id);

      const taskId = extractTaskId(payload);
      if (!taskId) throw new Error('KIE video submit response missing data.taskId');
      return {
        providerTaskId: taskId,
        providerLabel: `${this.name}.${opts.mode === 'image_to_video' ? 'i2v' : 't2v'}`,
        raw: payload,
      };
    } catch (err) {
      if (err instanceof KieCredentialError) throw err;
      if (httpStatus === 0) {
        logger.error({ err, body }, 'Network error submitting KIE video task');
        await logKieRequest(
          'POST',
          ENDPOINT_GENERATE,
          body,
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

  async fetchDetail(providerTaskId: string): Promise<VideoTaskDetail> {
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
        await logKieRequest('GET', ENDPOINT_DETAILS, { taskId: providerTaskId }, httpStatus, payload, failure.errorCode, Date.now() - start);
        if (failure.credentialFailure) {
          await markKieCredentialFailure(cred.id, failure.credentialFailure, failure.message);
          throw new KieCredentialError(failure.credentialFailure, cred.id, failure.message);
        }
        throw new Error(`KIE video detail fetch failed: ${failure.errorCode} ${failure.message}`);
      }

      await logKieRequest('GET', ENDPOINT_DETAILS, { taskId: providerTaskId }, httpStatus, payload, null, Date.now() - start);
      return parseDetail(payload, providerTaskId);
    } catch (err) {
      if (err instanceof KieCredentialError) throw err;
      if (httpStatus === 0) {
        logger.error({ err, providerTaskId }, 'Network error fetching KIE video detail');
        await logKieRequest(
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
}

export const kieVideoProvider: VideoProvider = new KieVideoProvider();

interface KieFailure {
  credentialFailure: 'invalid_key' | 'credits_exhausted' | null;
  errorCode: string;
  message: string;
}

function detectKieFailure(httpStatus: number, payload: unknown): KieFailure | null {
  if (httpStatus === 401) {
    return { credentialFailure: 'invalid_key', errorCode: 'http_401', message: 'Unauthorized' };
  }
  if (httpStatus === 402) {
    return { credentialFailure: 'credits_exhausted', errorCode: 'http_402', message: 'Insufficient credits' };
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
      if (code === 401) return { credentialFailure: 'invalid_key', errorCode: `kie_${code}`, message: msg };
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

function parseDetail(payload: unknown, providerTaskId: string): VideoTaskDetail {
  const data =
    payload && typeof payload === 'object' && (payload as { data?: unknown }).data
      ? ((payload as { data: unknown }).data as Record<string, unknown>)
      : {};
  // KIE jobs states: waiting / queuing / generating / success / fail.
  const rawState = typeof data.state === 'string' ? data.state.toUpperCase() : '';
  const status = mapStatus(rawState);
  const resultUrls = pluckResultUrls(data);
  const errorMessage =
    (typeof data.failMsg === 'string' && data.failMsg.length > 0 ? data.failMsg : null) ??
    (typeof data.errorMsg === 'string' && data.errorMsg.length > 0 ? data.errorMsg : null) ??
    null;
  return { providerTaskId, status, resultUrls, errorMessage, raw: payload };
}

function mapStatus(s: string): VideoTaskStatus {
  switch (s) {
    case 'SUCCESS':
      return 'success';
    case 'FAIL':
    case 'FAILED':
      return 'failed';
    case 'WAITING':
    case 'QUEUING':
    case 'QUEUEING':
      return 'pending';
    case 'GENERATING':
    case 'PROCESSING':
      return 'processing';
    default:
      return 'processing';
  }
}

function pluckResultUrls(data: Record<string, unknown>): string[] {
  // jobs API: data.resultJson adalah string JSON yang berisi { resultUrls: [...] }.
  const raw = data.resultJson;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as { resultUrls?: unknown };
      if (Array.isArray(parsed.resultUrls)) {
        return parsed.resultUrls.filter((u): u is string => typeof u === 'string');
      }
    } catch {
      // fall through
    }
  }
  return [];
}

function readMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const m = (payload as { msg?: unknown; message?: unknown }).msg ?? (payload as { message?: unknown }).message;
  return typeof m === 'string' ? m : null;
}

async function logKieRequest(
  method: string,
  endpoint: string,
  params: unknown,
  status: number,
  _body: unknown,
  errorCode: string | null,
  durationMs: number,
  errorMessage?: string,
): Promise<void> {
  // meta_request_logs requires connectionId yang KIE jobs tidak punya, jadi
  // request-level logging cukup via pino. Operation-level audit ditulis di
  // service.ts via withAudit() — itu yang masuk ke operation_audits.
  logger.debug(
    {
      method,
      endpoint: `kie:${endpoint}`,
      params,
      status,
      errorCode,
      durationMs,
      ...(errorMessage ? { errorMessage } : {}),
    },
    'KIE video request',
  );
}
