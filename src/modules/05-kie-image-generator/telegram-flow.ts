import { eq } from 'drizzle-orm';
import { db, logger } from '../00-foundation/index.js';
import { metaConnections } from '../../db/schema/meta-connections.js';
import { ensureKieCredentialFromEnv } from './bootstrap.js';
import { submitGeneration } from './service.js';
import { pollByAssetId } from './poller.js';
import {
  mirrorTaskFailed,
  mirrorTaskPending,
  mirrorTaskSucceeded,
} from './task-mirror.js';
import type { ContentAsset } from '../../db/schema/content-assets.js';

export interface TelegramGenerateInput {
  prompt: string;
  /** Optional context yang di-prepend ke prompt — dipakai oleh
   *  /generate_umroh untuk inject brand voice umroh. */
  contextPrefix?: string;
  /** Ratio aspect — default 1:1 (square iklan IG). */
  size?: '1:1' | '3:2' | '2:3' | '16:9' | '9:16';
  actorId: string;
}

export type TelegramGenerateResult =
  | {
      ok: true;
      asset: ContentAsset;
      resultUrls: string[];
      attempts: number;
      durationMs: number;
    }
  | {
      ok: false;
      reason: string;
      assetId?: string;
    };

const POLL_INTERVAL_MS = 4_000; // 4s — biar nggak hammer KIE
const POLL_TIMEOUT_MS = 5 * 60_000; // 5 menit hard cap

/**
 * Submit + wait flow: enqueue ke KIE, poll sampai success/failed/timeout,
 * return URLs hasil. Caller (Telegram handler) tinggal kirim photo
 * berdasarkan resultUrls[0].
 *
 * Mirror task ke `kie_tasks` table untuk billing/analytics tracking.
 */
export async function generateImageForTelegram(
  input: TelegramGenerateInput,
): Promise<TelegramGenerateResult> {
  const t0 = Date.now();

  // 1. Pastikan credential ada (lazy seed dari env).
  const cred = await ensureKieCredentialFromEnv();
  if (!cred.credentialId) {
    return {
      ok: false,
      reason: 'KIE_API_KEY belum di-set di env. Owner perlu konfigurasi dulu.',
    };
  }

  // 2. Pick first active Meta connection sebagai actor binding (audit row
  //    butuh connectionId — KIE call sendiri standalone).
  const [conn] = await db
    .select({ id: metaConnections.id })
    .from(metaConnections)
    .where(eq(metaConnections.status, 'active'))
    .limit(1);
  if (!conn) {
    return {
      ok: false,
      reason: 'Tidak ada Meta connection aktif (dipakai sebagai audit actor).',
    };
  }

  const finalPrompt = input.contextPrefix
    ? `${input.contextPrefix}\n\n${input.prompt}`
    : input.prompt;

  // 3. Submit ke KIE playground (default model: google/nano-banana).
  //    Migrasi 2026-04-26 dari /api/v1/gpt4o-image (yang ke "Internal
  //    Error" 4/4 attempt) ke /api/v1/playground/createTask — nano-banana
  //    return image dalam ~7s reliable.
  let submitResult;
  try {
    submitResult = await submitGeneration({
      connectionId: conn.id,
      actorId: input.actorId,
      prompt: finalPrompt,
      ...(input.size !== undefined ? { size: input.size } : {}),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err }, 'KIE submit failed');
    return { ok: false, reason: `Submit ke KIE gagal: ${msg}` };
  }

  // 4. Mirror ke kie_tasks (best-effort, jangan ganggu flow utama).
  const expiresAt = submitResult.asset.expiresAt ?? null;
  const kieTaskId = await mirrorTaskPending({
    taskType: 'image.generate',
    provider: 'kie.playground.nano-banana',
    providerTaskId: submitResult.providerTaskId,
    prompt: finalPrompt,
    inputParams: { size: input.size ?? '1:1' },
    createdBy: input.actorId,
    expiresAt,
  });

  // 5. Poll loop sampai success / failed / timeout.
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let attempts = 0;
  let lastAsset = submitResult.asset;

  while (Date.now() < deadline) {
    attempts += 1;
    try {
      const polled = await pollByAssetId(submitResult.asset.id);
      lastAsset = polled.asset;
      if (polled.status === 'success') {
        const urls = (polled.asset.resultUrls as string[] | null) ?? [];
        if (kieTaskId) await mirrorTaskSucceeded(kieTaskId, urls, null);
        return {
          ok: true,
          asset: polled.asset,
          resultUrls: urls,
          attempts,
          durationMs: Date.now() - t0,
        };
      }
      if (polled.status === 'failed') {
        const errMsg = polled.asset.errorMessage ?? 'KIE task failed';
        if (kieTaskId) await mirrorTaskFailed(kieTaskId, errMsg);
        return { ok: false, reason: errMsg, assetId: polled.asset.id };
      }
      // pending / processing → wait + retry
    } catch (err) {
      logger.warn({ err, assetId: submitResult.asset.id }, 'KIE poll attempt failed');
    }
    await sleep(POLL_INTERVAL_MS);
  }

  if (kieTaskId) await mirrorTaskFailed(kieTaskId, 'timeout: 5 menit terlewati');
  return {
    ok: false,
    reason: `Generate timeout setelah ${attempts} polls (5 menit). Cek /tmp/maa-*.log atau status di Meta.`,
    assetId: lastAsset.id,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
