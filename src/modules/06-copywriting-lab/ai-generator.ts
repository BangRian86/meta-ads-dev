import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
// zodOutputFormat from @anthropic-ai/sdk@0.91 walks the schema using zod v4
// internals (`z.toJSONSchema`). Importing from `zod` (v3 surface) here gives
// schemas without `_zod.def` and triggers
// "Cannot read properties of undefined (reading 'def')". Use the v4 entry
// point so toJSONSchema can introspect properly.
import { z } from 'zod/v4';
import { config } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { db } from '../../db/index.js';
import { aiUsageLogs } from '../../db/schema/ai-usage-logs.js';
import { computeCostUsd } from '../10-telegram-bot/ai-pricing.js';
import type { Brand } from '../14-meta-progress/index.js';
import type { VariantFields } from './schema.js';

let client: Anthropic | null = null;

function getClient(): Anthropic | null {
  if (!config.anthropic.isConfigured) return null;
  if (!client) {
    client = new Anthropic({ apiKey: config.anthropic.apiKey });
  }
  return client;
}

// Schema we ask Claude to fill. Bounds match Meta ad copy limits + leave
// room for the model to be terse rather than fluffy. Rationale upper-bound
// is intentionally loose (500) — past runs saw the model write 320–450 char
// rationales for one variant and fail the whole batch.
const aiVariantSchema = z.object({
  primaryText: z
    .string()
    .min(20)
    .max(900)
    .describe('Body text iklan, Bahasa Indonesia, hindari Markdown.'),
  headline: z
    .string()
    .min(5)
    .max(60)
    .describe('Judul singkat, max ~40 karakter ideal.'),
  cta: z
    .string()
    .min(2)
    .max(40)
    .describe('CTA pendek action verb, mis. "Kirim WA", "Daftar Sekarang".'),
  rationale: z
    .string()
    .min(10)
    .max(500)
    .describe('1-2 kalimat penjelasan kenapa variasi ini diharapkan lebih baik.'),
});

// Public response shape — kept for callsite/type compatibility. The exact
// `.length(3)` constraint moved out to the orchestrator (3 fixed parallel
// calls), so here we accept 1-3 to model the partial-success path.
const aiResponseSchema = z.object({
  variants: z.array(aiVariantSchema).min(1).max(3),
  audienceSuggestion: z
    .string()
    .min(20)
    .max(400)
    .describe(
      'Saran audience terbaik dalam Bahasa Indonesia (mis. "LAL 1% dari engagers 60 hari" atau "broad targeting Jabodetabek 28-55 muslim"). 1 kalimat.',
    ),
});
export type AiCopyResponse = z.infer<typeof aiResponseSchema>;

// Per-call wrappers. Anthropic's structured-output requires a top-level
// object, so the single variant gets wrapped under `variant`.
const aiSingleVariantResponseSchema = z.object({ variant: aiVariantSchema });
const aiAudienceResponseSchema = z.object({
  audienceSuggestion: aiResponseSchema.shape.audienceSuggestion,
});

export interface BadAdContext {
  campaignId: string;
  campaignName: string;
  objective: string | null;
  cprIdr: number;
  cprThresholdIdr: number;
  spendIdr: number;
  results: number;
  ctrPct: number;
  ageDays: number | null;
  resultActionType: string | null;
  /** Bisnis di balik campaign ini — derive dari accountName via
   *  detectBrand() di module 14. Kalau tidak di-set, default 'basmalah'
   *  (preserves perilaku lama supaya callsite optional). */
  brand?: Brand;
}

export interface GeneratedVariantBundle {
  variants: VariantFields[];
  rationales: string[];
  audienceSuggestion: string;
  raw: AiCopyResponse;
}

export type GenerateResult =
  | { ok: true; data: GeneratedVariantBundle }
  | { ok: false; reason: string };

interface UsageBucket {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

// Aturan output common — sama untuk dua bisnis. Diappend ke system prompt
// per-bisnis di bawah supaya schema validation tetap konsisten.
const COMMON_OUTPUT_RULES = `Aturan output (WAJIB diikuti, output di-validate ketat):
- Bahasa Indonesia, plain text (tanpa Markdown).
- Primary text: 80-150 kata, ada hook di awal.
- Headline: tegas, max ~40 karakter (Meta truncate setelah itu).
- CTA: imperative verb pendek (Kirim WA, Konsultasi Gratis, Daftar Sekarang, dll).
- Rationale: RINGKAS DAN PADAT — maksimal 250 kata, idealnya 1-3 kalimat. Jelaskan kenapa variasi ini berbeda dari iklan asli & expected impact. JANGAN bertele-tele atau ulang-ulang isi copy.
- HINDARI: clickbait berlebihan, klaim hadiah palsu, all-caps berlebihan, emoji bombing.
- Output JSON tunggal mengikuti schema — JANGAN bungkus dalam array, JANGAN tambah field lain di luar schema.`;

const SYSTEM_PROMPTS: Record<Brand, string> = {
  basmalah: `Kamu adalah copywriter senior untuk Basmalah Travel — agen perjalanan umroh di Indonesia. Tugas kamu: bikin SATU (1) variasi copy iklan Meta yang LEBIH BAIK dari iklan eksisting yang sedang underperform. Sudut pandang variasi akan ditentukan oleh user prompt.

Karakteristik audience Basmalah Travel:
- Muslim Indonesia usia 28-55, urban (Jabodetabek, Bandung, Surabaya)
- Sudah punya niat umroh tapi mungkin pertama kali / cari opsi paket
- Concern utama: harga, kepercayaan agen, jadwal keberangkatan, fasilitas hotel & pesawat
- Bahasa: Indonesia santai-formal dengan sentuhan religius (alhamdulillah, insyaAllah, niat baik) — JANGAN berlebihan

${COMMON_OUTPUT_RULES}`,

  aqiqah: `Kamu adalah copywriter untuk bisnis layanan aqiqah. Buat copy iklan yang relevan dengan layanan aqiqah: pemesanan hewan aqiqah, paket aqiqah lengkap, layanan masak dan distribusi, harga terjangkau, pengiriman ke seluruh wilayah. Tugas kamu: bikin SATU (1) variasi copy iklan Meta yang LEBIH BAIK dari iklan eksisting yang sedang underperform. Sudut pandang variasi akan ditentukan oleh user prompt.

Karakteristik audience layanan aqiqah:
- Orang tua muslim Indonesia, baru saja punya bayi atau anak balita
- Mencari layanan aqiqah praktis (hewan + masak + distribusi sekaligus)
- Concern utama: harga, kualitas hewan (sehat, sesuai syariat), kemudahan pengiriman, kebersihan masakan, kapan bisa di-deliver
- Cycle decision cepat (1-7 hari) karena ada acara aqiqahan / kelahiran momen-driven
- Bahasa: Indonesia santai-formal dengan sentuhan religius (alhamdulillah, insyaAllah, sunnah Rasul, syukur kelahiran) — JANGAN berlebihan

${COMMON_OUTPUT_RULES}`,
};

interface Angle {
  key: string;
  label: string;
  brief: string;
}

const ANGLES: Record<Brand, Angle[]> = {
  basmalah: [
    {
      key: 'emotional',
      label: 'Emotional/Spiritual',
      brief:
        'Sentuh sisi niat, doa, momen ketenangan. Bicara ke hati — kenapa umroh lebih dari sekadar perjalanan.',
    },
    {
      key: 'trust',
      label: 'Trust/Social Proof',
      brief:
        'Tonjolkan testimoni, jumlah jemaah yang sudah berangkat, pengalaman agen, reputasi. Bangun kepercayaan.',
    },
    {
      key: 'urgency',
      label: 'Urgency/Practical',
      brief:
        'Soroti promo terbatas, kuota tersisa, jadwal dekat, fasilitas konkret (hotel, pesawat, harga). Dorong action sekarang.',
    },
  ],
  aqiqah: [
    {
      key: 'emotional',
      label: 'Emotional/Spiritual',
      brief:
        'Sentuh sisi sunnah Rasul, ungkapan syukur atas kelahiran anak, niat baik orang tua mendoakan buah hati. Hangat dan personal.',
    },
    {
      key: 'trust',
      label: 'Trust/Social Proof',
      brief:
        'Tonjolkan testimoni orang tua yang puas, jumlah keluarga yang sudah pakai layanan, hewan sehat sesuai syariat, sertifikat halal, kebersihan dapur.',
    },
    {
      key: 'urgency',
      label: 'Urgency/Practical',
      brief:
        'Soroti paket lengkap (hewan + masak + distribusi), harga jelas, jangkauan pengiriman luas, slot terbatas untuk weekend / acara dekat. Dorong action sekarang.',
    },
  ],
};

const AUDIENCE_SYSTEM_PROMPTS: Record<Brand, string> = {
  basmalah: `Kamu adalah media buyer senior untuk kampanye Meta Ads Basmalah Travel (umroh). Berdasarkan info campaign yang under-performing yang diberikan user, pilih SATU saran audience terbaik untuk fix campaign tersebut. Output 1 kalimat saja, Bahasa Indonesia.

Pilih dari opsi umum:
- "LAL 1% dari engagers 60 hari" (cocok kalau campaign sudah ada engagement history)
- "LAL 2-3% dari pembeli/leads existing" (kalau ada conversion data)
- "Broad targeting Jabodetabek usia 30-55 muslim" (kalau audience saat ini mungkin terlalu sempit)
- "Retarget engagers 30 hari" (kalau campaign untuk closing/BOFU)
- "Custom audience dari database jamaah existing" (kalau ada list pelanggan)
Pilih yang paling masuk akal berdasarkan objective + performance metrics. Output dengan field "audienceSuggestion".`,

  aqiqah: `Kamu adalah media buyer senior untuk kampanye Meta Ads layanan aqiqah. Berdasarkan info campaign yang under-performing yang diberikan user, pilih SATU saran audience terbaik untuk fix campaign tersebut. Output 1 kalimat saja, Bahasa Indonesia.

Pilih dari opsi umum:
- "LAL 1% dari pembeli aqiqah 60 hari" (kalau ada conversion history)
- "LAL 2-3% dari engagers IG/FB" (kalau audience belum besar)
- "Broad targeting orang tua muda 25-40 muslim wilayah cabang" (kalau audience terlalu sempit)
- "Interest: parenting, baby care, muslim family" (kalau pakai interest targeting)
- "Retarget engagers 30 hari" (kalau untuk closing leads yang sudah aware)
- "Custom audience dari database pelanggan existing" (kalau ada list pelanggan)
Pilih yang paling masuk akal berdasarkan objective + performance metrics. Output dengan field "audienceSuggestion".`,
};

function brandFor(ctx: BadAdContext): Brand {
  return ctx.brand ?? 'basmalah';
}

function buildAdContextLines(ctx: BadAdContext): string[] {
  return [
    `Iklan yang perlu diperbaiki:`,
    `- Campaign: "${ctx.campaignName}" (id ${ctx.campaignId})`,
    `- Objective Meta: ${ctx.objective ?? 'unknown'}`,
    `- Sudah jalan: ${ctx.ageDays ?? '?'} hari`,
    `- Spend 7 hari: Rp ${Math.round(ctx.spendIdr).toLocaleString('id-ID')}`,
    `- Results 7 hari: ${ctx.results} (event type: ${ctx.resultActionType ?? 'n/a'})`,
    `- CPR aktual: Rp ${Math.round(ctx.cprIdr).toLocaleString('id-ID')}`,
    `- Threshold target: ≤ Rp ${Math.round(ctx.cprThresholdIdr).toLocaleString('id-ID')}`,
    `- CTR: ${ctx.ctrPct}%`,
  ];
}

function buildVariantPrompt(
  ctx: BadAdContext,
  angle: Angle,
  isRetry: boolean,
): string {
  const lines = buildAdContextLines(ctx);
  lines.push('');
  lines.push(`Sudut pandang untuk variasi ini: **${angle.label}**`);
  lines.push(angle.brief);
  lines.push('');
  lines.push(
    `Generate SATU (1) variasi copy baru (primaryText, headline, cta, rationale) ` +
      `pakai sudut pandang di atas. Target: lower CPR.`,
  );
  if (isRetry) {
    lines.push('');
    lines.push(
      `CATATAN PENTING: percobaan sebelumnya gagal validasi schema. Pastikan: ` +
        `rationale ≤500 karakter (idealnya jauh lebih pendek, 1-3 kalimat), ` +
        `headline ≤60 karakter, primaryText antara 20-900 karakter, cta ≤40 karakter.`,
    );
  }
  return lines.join('\n');
}

function buildAudiencePrompt(ctx: BadAdContext): string {
  const lines = buildAdContextLines(ctx);
  lines.push('');
  lines.push(
    `Pilih SATU saran audience terbaik untuk fix campaign ini. Output 1 kalimat ringkas (20-400 karakter).`,
  );
  return lines.join('\n');
}

function accumulateUsage(
  bucket: UsageBucket,
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
  },
): void {
  bucket.inputTokens += usage.input_tokens;
  bucket.outputTokens += usage.output_tokens;
  bucket.cacheReadTokens += usage.cache_read_input_tokens ?? 0;
  bucket.cacheCreationTokens += usage.cache_creation_input_tokens ?? 0;
}

async function generateOneVariant(
  c: Anthropic,
  ctx: BadAdContext,
  angle: Angle,
  bucket: UsageBucket,
): Promise<z.infer<typeof aiVariantSchema> | null> {
  // Defensive: schema must be defined at module load. If a circular import
  // or build glitch ever leaves it undefined, surface a loud error rather
  // than crashing inside zodOutputFormat with the cryptic ".def" message.
  if (!aiSingleVariantResponseSchema) {
    logger.error(
      { angle: angle.key, campaignId: ctx.campaignId },
      'aiSingleVariantResponseSchema is undefined — module load issue',
    );
    return null;
  }

  for (let attempt = 0; attempt <= 1; attempt += 1) {
    try {
      const response = await c.messages.parse({
        model: config.anthropic.model,
        max_tokens: 1200,
        system: SYSTEM_PROMPTS[brandFor(ctx)],
        messages: [
          { role: 'user', content: buildVariantPrompt(ctx, angle, attempt > 0) },
        ],
        // The SDK's zodOutputFormat is typed against zod v3 ZodType but its
        // implementation needs a v4 schema (see import note above).
        output_config: {
          format: zodOutputFormat(aiSingleVariantResponseSchema as never),
        },
      });
      accumulateUsage(bucket, response.usage);
      if (!response.parsed_output) {
        logger.warn(
          { angle: angle.key, attempt, campaignId: ctx.campaignId },
          'Variant call returned no parsed_output',
        );
        if (attempt === 0) continue;
        return null;
      }
      const parsed = response.parsed_output as z.infer<
        typeof aiSingleVariantResponseSchema
      >;
      return parsed.variant;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(
        { angle: angle.key, attempt, campaignId: ctx.campaignId, err: msg },
        attempt === 0
          ? 'Variant generation failed — retrying once'
          : 'Variant generation failed after retry',
      );
      if (attempt === 0) continue;
      return null;
    }
  }
  return null;
}

async function generateAudienceSuggestion(
  c: Anthropic,
  ctx: BadAdContext,
  bucket: UsageBucket,
): Promise<string | null> {
  if (!aiAudienceResponseSchema) {
    logger.error(
      { campaignId: ctx.campaignId },
      'aiAudienceResponseSchema is undefined — module load issue',
    );
    return null;
  }

  for (let attempt = 0; attempt <= 1; attempt += 1) {
    try {
      const response = await c.messages.parse({
        model: config.anthropic.model,
        max_tokens: 400,
        system: AUDIENCE_SYSTEM_PROMPTS[brandFor(ctx)],
        messages: [{ role: 'user', content: buildAudiencePrompt(ctx) }],
        output_config: {
          format: zodOutputFormat(aiAudienceResponseSchema as never),
        },
      });
      accumulateUsage(bucket, response.usage);
      if (!response.parsed_output) {
        if (attempt === 0) continue;
        return null;
      }
      const parsed = response.parsed_output as z.infer<
        typeof aiAudienceResponseSchema
      >;
      return parsed.audienceSuggestion;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(
        { attempt, campaignId: ctx.campaignId, err: msg },
        attempt === 0
          ? 'Audience suggestion failed — retrying once'
          : 'Audience suggestion failed after retry',
      );
      if (attempt === 0) continue;
      return null;
    }
  }
  return null;
}

export async function generateAiVariantsForBadAd(
  ctx: BadAdContext,
): Promise<GenerateResult> {
  const c = getClient();
  if (!c) return { ok: false, reason: 'AI not configured (set ANTHROPIC_API_KEY).' };

  const usage: UsageBucket = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  };

  // Three fixed parallel variant calls (one per angle) + one audience call.
  // Each helper handles its own retry + try/catch, so a single failure
  // doesn't abort the whole batch — we keep whatever returned non-null.
  // Angles dipilih berdasarkan brand campaign — Aqiqah punya angle yang
  // beda dari Basmalah (umroh vs aqiqah konteks).
  const angles = ANGLES[brandFor(ctx)];
  const [variantResults, audienceSuggestion] = await Promise.all([
    Promise.all(angles.map((angle) => generateOneVariant(c, ctx, angle, usage))),
    generateAudienceSuggestion(c, ctx, usage),
  ]);

  const variants: VariantFields[] = [];
  const rationales: string[] = [];
  const rawVariants: z.infer<typeof aiVariantSchema>[] = [];
  for (const v of variantResults) {
    if (!v) continue;
    variants.push({
      primaryText: v.primaryText,
      headline: v.headline,
      cta: v.cta,
      language: 'id',
    });
    rationales.push(v.rationale);
    rawVariants.push(v);
  }

  if (variants.length === 0) {
    return {
      ok: false,
      reason: 'All 3 variant generations failed (after retry).',
    };
  }

  const finalAudience =
    audienceSuggestion ?? 'Broad targeting Jabodetabek usia 30-55 muslim';

  const costUsd = computeCostUsd(config.anthropic.model, usage);
  try {
    await db.insert(aiUsageLogs).values({
      model: config.anthropic.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheCreationTokens: usage.cacheCreationTokens,
      costUsd: costUsd.toString(),
      feature: 'copy_fix_generator',
    });
  } catch (logErr) {
    logger.warn({ err: logErr }, 'Failed to persist ai_usage_logs row (copy gen)');
  }

  if (variants.length < angles.length) {
    logger.warn(
      {
        campaignId: ctx.campaignId,
        succeeded: variants.length,
        attempted: angles.length,
      },
      'Copy fix completed with partial variants',
    );
  }

  return {
    ok: true,
    data: {
      variants,
      rationales,
      audienceSuggestion: finalAudience,
      raw: { variants: rawVariants, audienceSuggestion: finalAudience },
    },
  };
}
