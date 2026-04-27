/**
 * VideoProvider — abstraksi tipe-tipe penyedia video generation.
 *
 * Dipakai supaya service/telegram-flow tidak hard-code KIE-specific shape
 * dan kalau suatu hari mau swap ke provider lain (Replicate, Fal,
 * native Veo) tinggal implement interface yang sama.
 *
 * Saat ini ada satu implementasi: `kie-video-client.ts` yang membungkus
 * KIE.ai jobs API dengan model Wan 2.7.
 */

export type VideoTaskStatus = 'pending' | 'processing' | 'success' | 'failed';

export type VideoMode = 'text_to_video' | 'image_to_video';

export interface VideoSubmitOptions {
  mode: VideoMode;
  prompt: string;
  /** "720p" / "1080p". Provider boleh ignore kalau model fix. */
  resolution?: string;
  /** Detik. Wan 2.7 menerima 2-15. */
  durationSec?: number;
  /** "16:9" / "9:16" / "1:1" / "4:3" / "3:4". */
  ratio?: string;
  /** Required untuk mode='image_to_video'. URL gambar publik (HTTPS). */
  firstFrameUrl?: string;
  /** Forward provider-specific extras (mis. seed, watermark, callBackUrl). */
  extra?: Record<string, unknown>;
}

export interface VideoSubmitResult {
  /** ID task di sistem provider. Disimpan ke
   *  content_assets.providerTaskId untuk polling. */
  providerTaskId: string;
  /** Provider sub-identifier untuk billing/analytics
   *  (mis. "kie.jobs.wan-2-7-text-to-video"). */
  providerLabel: string;
  /** Raw response dari provider — di-log ke audit. */
  raw: unknown;
}

export interface VideoTaskDetail {
  providerTaskId: string;
  status: VideoTaskStatus;
  /** URL hasil video (umumnya mp4). Kosong selama belum success. */
  resultUrls: string[];
  errorMessage: string | null;
  raw: unknown;
}

export interface VideoProvider {
  /** Identifier provider — buat log + selektor di service. */
  readonly name: string;
  submit(opts: VideoSubmitOptions): Promise<VideoSubmitResult>;
  fetchDetail(providerTaskId: string): Promise<VideoTaskDetail>;
}
