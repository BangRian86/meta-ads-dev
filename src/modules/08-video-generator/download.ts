import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { logger } from '../00-foundation/index.js';

/**
 * Local cache root untuk video yang sudah di-generate. URL dari KIE
 * (`tempfile.aiquickdraw.com/...`) expire dalam beberapa jam, jadi
 * setelah generate sukses kita download mp4 ke disk supaya asset
 * tetap reachable selama TTL `content_assets.expiresAt` (default 14d).
 *
 * Path absolute supaya Telegraf `replyWithVideo({ source })` bisa
 * langsung baca, dan supaya cleanup cron nanti tidak ambigu.
 */
const VIDEO_DIR = resolve('/root/meta-ads-dev/data/assets/videos');

export interface DownloadResult {
  /** Absolute file path di server lokal. */
  localPath: string;
  /** URL asal KIE — disimpan di metadata buat audit. */
  originalUrl: string;
  bytes: number;
}

/**
 * Download satu URL ke disk dan return absolute path. Best-effort —
 * caller harus handle error sendiri (umumnya: fallback ke URL asal).
 *
 * Nama file: <assetId>[-<index>].mp4. Index cuma di-append kalau ada
 * multi-result; Wan T2V single-result tapi defensive.
 */
export async function downloadVideoToLocal(
  url: string,
  assetId: string,
  index: number,
  totalResults: number,
): Promise<DownloadResult> {
  await mkdir(VIDEO_DIR, { recursive: true });
  const filename =
    totalResults > 1 ? `${assetId}-${index}.mp4` : `${assetId}.mp4`;
  const localPath = resolve(VIDEO_DIR, filename);

  const t0 = Date.now();
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} fetching ${url}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(localPath, buf);
  logger.info(
    { assetId, localPath, bytes: buf.length, durationMs: Date.now() - t0 },
    'Video downloaded to local cache',
  );
  return { localPath, originalUrl: url, bytes: buf.length };
}

/**
 * Download every URL in parallel. Returns matched arrays (1:1 dengan
 * input) so caller bisa zip metadata. Kalau salah satu gagal, error
 * di-throw — caller boleh fallback ke originalUrls.
 */
export async function downloadAllToLocal(
  urls: string[],
  assetId: string,
): Promise<DownloadResult[]> {
  return Promise.all(
    urls.map((u, i) => downloadVideoToLocal(u, assetId, i, urls.length)),
  );
}
