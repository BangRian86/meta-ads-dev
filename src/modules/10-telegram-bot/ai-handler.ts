import Anthropic from '@anthropic-ai/sdk';
import { config } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { db } from '../../db/index.js';
import { aiUsageLogs } from '../../db/schema/ai-usage-logs.js';
import { buildAdsContext, formatContextForPrompt } from './ai-context.js';
import { computeCostUsd } from './ai-pricing.js';
import { buildSheetsAiContext } from '../30-sheets-reader/ai-context.js';

let client: Anthropic | null = null;

function getClient(): Anthropic | null {
  if (!config.anthropic.isConfigured) return null;
  if (!client) {
    client = new Anthropic({ apiKey: config.anthropic.apiKey });
  }
  return client;
}

const SYSTEM_PROMPT_BASE = `Kamu adalah Meta Ads assistant yang mengelola beberapa ad account sekaligus untuk grup bisnis ini (Basmalah Travel — agen perjalanan umroh, dan Aqiqah Express — layanan aqiqah dengan beberapa region: PUSAT, JATIM, JABAR, JOGJA/Yogyakarta). Setiap akun di context block ditandai dengan baris "ACCOUNT: <nama> (act_<id>)" + "brand: aqiqah/basmalah".

Jawab HANYA berdasarkan data di blok "Data context" — jangan mengarang angka, nama campaign, akun, atau tren. Kalau pertanyaan butuh data yang tidak ada di context, sampaikan terus terang.

Konvensi data:
- Semua mata uang dalam IDR (Rupiah).
- "CPR" = Cost Per Result = spend / results (result = event optimization Meta, misal lead, purchase, link_click).
- "CTR" = clicks / impressions × 100, dalam persen.
- "ageDays" = berapa hari sejak campaign dibuat.
- Campaign status PAUSED = sedang tidak spend; ACTIVE = sedang spend.
- effective_status menunjukkan pengiriman iklan: ACTIVE = delivering, CAMPAIGN_PAUSED / PAUSED = tidak delivering, DISAPPROVED / WITH_ISSUES = diblokir.
- "GRAND TOTALS" di bagian atas adalah agregat lintas semua akun. Setiap section "ACCOUNT:" adalah satu ad account.
- Setiap campaign punya "benchmark (channel): cheap < Rp X, expensive > Rp Y" — ini threshold per-bisnis × per-channel. CPR di bawah cheap = bagus ✅, di atas expensive = buruk ⚠️. Channel "sales" punya tier threshold lebih tinggi karena event-nya purchase.
- Tiap campaign punya baris "Budget harian: Rp X (CBO|ABO)". CBO = budget di-set di campaign level dan dibagi otomatis ke adset. ABO = budget di-set per-adset; angka yang ditampilkan adalah SUM daily_budget semua adset aktif (non-paused). "pakai lifetime_budget" = campaign nggak pakai daily, ada total budget jangka panjang. "belum ke-sync" = data field belum tersedia dari sync terakhir.

Filter akun berbasis pertanyaan:
- Kalau user sebut akun spesifik ("akun pusat", "JABAR", "Aqiqah JATIM", "Basmalah", dll), FOKUS jawaban hanya ke akun yang match. Akun "PUSAT" ada di Aqiqah dan Basmalah — kalau user nggak spesifik bisnisnya, tanya balik atau jawab keduanya dengan jelas dipisah.
- Kalau user nggak sebut akun, default scope adalah semua akun.

Cara menjawab:
- Default jawaban dalam Bahasa Indonesia. Kalau pertanyaan dalam Bahasa Inggris, baru jawab Inggris.
- Singkat dan padat — biasanya 2-4 paragraf pendek. Hindari basa-basi.
- Selalu sebutkan akun + nama campaign + id kalau jawaban menyangkut campaign tertentu. Jangan ambigu — operator mengelola banyak akun.
- Untuk pertanyaan "campaign terjelek" / "yang harus di-pause" / "rekomendasi perbaikan": rangking by CPR vs benchmark expensive (paling jauh di atas = paling buruk), tampilkan top 3 kandidat dengan nama + akun + id + CPR vs benchmark + alasan singkat.
- Untuk "yang harus di-scale": rangking by CPR vs benchmark cheap + spend signifikan + age > learning phase, tampilkan top 3.
- Untuk "akun mana yang...?" atau "perbandingan antar akun", pakai data subtotal/grand total.
- Untuk ROAS dari Meta API: data TIDAK punya revenue/nilai konversi, hanya jumlah "results" dan CPR. Kalau ditanya ROAS, jelaskan bahwa revenue per result di luar scope context ini dan arahkan user pakai /roas (Sheets-based).
- Untuk pertanyaan budget harian ("berapa budget X", "budget campaign Y berapa"): jawab dengan angka pasti dari baris "Budget harian:" di context — bukan estimasi dari spend atau spend rata-rata. Selalu sebut apakah CBO atau ABO supaya operator tahu di level mana budget di-set. Kalau baris budget "belum ke-sync" atau "pakai lifetime_budget", bilang terus terang dan jangan tebak angkanya.
- Untuk "minggu ini" / "this week": pakai jendela 7 hari yang sudah ada di context.
- Pakai plain text. JANGAN pakai Markdown (tanpa *, _, \`, atau # — Telegram render karakter ini secara literal).`;

export type AnswerResult =
  | { ok: true; text: string; usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number } }
  | { ok: false; reason: string };

/**
 * Cheap intent router: when the user types a free-text question that maps
 * cleanly to an existing slash command, dispatch the command instead of
 * burning a Claude call.
 *
 * Returns the canonical command name to run, or null if the text should
 * fall through to natural-language Q&A.
 *
 * Order matters where one phrase is a sub-string of another (e.g.
 * "status campaign" is checked before "status iklan" via specificity).
 */
export type CommandIntent = 'progress' | 'sheets' | 'accounts' | 'status';

// Pattern intent SENGAJA SEMPIT — hanya trigger slash command kalau user
// jelas-jelas minta report rutin (bukan analysis question). Pertanyaan
// analitik seperti "campaign terjelek", "rekomendasi perbaikan", "akun
// mana yang harus di-pause" harus jatuh ke Claude AI dengan context
// data, bukan ter-route ke /accounts atau /progress.
//
// Aturan:
// - Pattern HARUS punya 2+ kata distinct yang spesifik command (mis.
//   "progress iklan" bukan cuma "iklan", "list akun" bukan cuma "akun").
// - Hindari kata generic seperti "spend", "iklan", "akun" sendirian.
const INTENT_PATTERNS: Array<{ intent: CommandIntent; re: RegExp }> = [
  // Most specific first.
  { intent: 'status', re: /\bstatus\s+campaign\b/i },
  {
    intent: 'progress',
    re: /\b(progress\s+iklan|update\s+iklan|laporan\s+iklan)\b/i,
  },
  { intent: 'sheets', re: /\b(laporan\s+sheets|data\s+cs)\b/i },
  {
    intent: 'accounts',
    re: /\b(tampilkan\s+accounts?|list\s+akun)\b/i,
  },
];

export function detectCommandIntent(text: string): CommandIntent | null {
  const t = text.trim();
  if (!t) return null;
  for (const p of INTENT_PATTERNS) {
    if (p.re.test(t)) return p.intent;
  }
  return null;
}

/**
 * Detect kalau pertanyaan butuh DATA SHEETS (CS performance, channel
 * breakdown Meta/TikTok/Google, trend revenue, biaya per chat, dll).
 * Kalau hit → caller route ke answerSheetsQuestion (Sheets context).
 * Kalau miss → fall through ke answerQuestion (Meta-API context).
 */
const SHEETS_INTENT_PATTERNS: RegExp[] = [
  // CS performance
  /\b(cs|customer\s+service|naila|putri|fikri|dinda|nabila|amel|adinda|mega|elsa|citra|yanah|vica|annisa|aulin)\b/i,
  /\b(closing\s+rate|performa\s+cs|siapa\s+(yang\s+)?(terbaik|paling|top))\b/i,
  // Channel comparison
  /\b(tiktok|google\s+ads|meta\s+vs|bandingkan|compare|channel|per\s+channel)\b/i,
  // Trend
  /\b(minggu\s+ini|bulan\s+ini|trend|tren|naik|turun|kemarin\s+vs|dibanding(kan)?\s+(minggu|bulan|kemarin))\b/i,
  // Cost-from-sheet
  /\b(cost\s+per\s+(chat|closing|ekor|jamaah)|biaya\s+per\s+(chat|closing|cs)|cpc\s+sheet|cpm\s+sheet)\b/i,
  // Revenue / closing total dari Sheets
  /\b(revenue|omset|omzet|total\s+closing|total\s+ekor|nilai\s+invoice)\b/i,
];

export function detectSheetsIntent(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  for (const re of SHEETS_INTENT_PATTERNS) {
    if (re.test(t)) return true;
  }
  return false;
}

const SHEETS_SYSTEM_PROMPT = `Kamu adalah analyst yang punya akses ke Google Sheets dashboard milik 2 bisnis: Basmalah Travel (umroh, 1 cabang PUSAT) dan Aqiqah Express (4 cabang: PUSAT, JABAR, JATIM, JOGJA).

Data context di bawah berisi snapshot dari Sheets — sumber kebenaran satu-satunya. JANGAN mengarang angka yang tidak ada.

Konvensi data:
- Semua mata uang dalam IDR (Rupiah).
- Window SHORT = 7 hari terakhir, LONG = 30 hari terakhir.
- "Real chat" = chat masuk WhatsApp yang sudah ter-validasi (bukan ATC iklan mentah).
- "Closing" = jumlah deal yang masuk untuk window itu.
- "Ekor" (Aqiqah) atau "Keberangkatan" (Basmalah) = unit hewan / jamaah yang ter-realisasi.
- "Revenue" = total nilai invoice dari closing di window.
- "ROAS" = rata-rata harian dari kolom AN di tab REPORTING — sudah dihitung di Sheet, jangan recompute. Kalau ditanya ROAS range, sebut bahwa angka adalah AVERAGE harian.
- "Biaya iklan" sudah include 11% pajak Meta/Google/TikTok di kolom V (Total Biaya Iklan).
- Sel "-" / "0" / kosong = belum ada data hari itu, BUKAN nol absolut.
- "PER-DAY" tail di tiap branch block = data harian terakhir buat trend question.

Cara menjawab:
- Default Bahasa Indonesia, kalau pertanyaan English baru jawab English.
- Singkat (2-4 paragraf pendek). Hindari basa-basi.
- Selalu sebut bisnis + cabang spesifik kalau angka bicara per-akun.
- Format Rupiah pakai titik (Rp 1.500.000), persentase pakai koma (12,5%), ROAS pakai "x" (4.20x).
- Plain text, JANGAN Markdown (Telegram render literal).
- Kalau data yang dibutuhkan TIDAK ada di context (mis. tab tertentu gagal di-baca, periode di luar window 30 hari, atau metric belum tercatat di Sheets), bilang terus terang.`;

export async function answerSheetsQuestion(question: string): Promise<AnswerResult> {
  const c = getClient();
  if (!c) return { ok: false, reason: 'AI not configured (set ANTHROPIC_API_KEY).' };

  let contextText: string;
  try {
    const ctx = await buildSheetsAiContext();
    contextText = ctx.text;
    if (!contextText.trim()) {
      return {
        ok: false,
        reason: 'Sheets data context kosong — coba lagi sebentar atau pakai /roas / /cabang langsung.',
      };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err }, 'Failed to build Sheets AI context');
    return { ok: false, reason: `Sheets context load gagal: ${msg}` };
  }

  try {
    const response = await c.messages.create({
      model: config.anthropic.model,
      max_tokens: config.anthropic.maxTokens,
      system: [
        {
          type: 'text',
          text: SHEETS_SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Data context (Sheets snapshot):\n\n${contextText}`,
              cache_control: { type: 'ephemeral' },
            },
            { type: 'text', text: question },
          ],
        },
      ],
    });

    const textBlock = response.content.find(
      (b): b is Anthropic.TextBlock => b.type === 'text',
    );
    if (!textBlock || textBlock.text.trim().length === 0) {
      return { ok: false, reason: 'AI returned no text content.' };
    }

    const usage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
    };
    const costUsd = computeCostUsd(config.anthropic.model, usage);

    try {
      await db.insert(aiUsageLogs).values({
        model: config.anthropic.model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheReadTokens,
        cacheCreationTokens: usage.cacheCreationTokens,
        costUsd: costUsd.toString(),
        feature: 'telegram_qna_sheets',
      });
    } catch (logErr) {
      logger.warn(
        { err: logErr },
        'Failed to persist ai_usage_logs row (sheets qna)',
      );
    }

    logger.debug({ ...usage }, 'AI sheets answer generated');
    return { ok: true, text: textBlock.text, usage };
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      return { ok: false, reason: 'AI auth failed — check ANTHROPIC_API_KEY.' };
    }
    if (err instanceof Anthropic.RateLimitError) {
      return { ok: false, reason: 'AI rate-limited — coba lagi sebentar.' };
    }
    if (err instanceof Anthropic.APIError) {
      logger.error({ err: err.message, status: err.status }, 'Anthropic API error (sheets)');
      return { ok: false, reason: `AI error (${err.status}): ${err.message}` };
    }
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err }, 'AI sheets call failed');
    return { ok: false, reason: `AI call failed: ${msg}` };
  }
}

export async function answerQuestion(question: string): Promise<AnswerResult> {
  const c = getClient();
  if (!c) return { ok: false, reason: 'AI not configured (set ANTHROPIC_API_KEY).' };

  let contextBlock: string;
  let accountCount = 0;
  try {
    const ctx = await buildAdsContext();
    contextBlock = formatContextForPrompt(ctx);
    accountCount = ctx.accounts.length;
    if (accountCount === 0) {
      return {
        ok: false,
        reason: 'Belum ada akun aktif di database. Tambahkan minimal satu Meta connection.',
      };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err }, 'Failed to build multi-account ads context');
    return { ok: false, reason: `Could not load ads context: ${msg}` };
  }

  try {
    const response = await c.messages.create({
      model: config.anthropic.model,
      max_tokens: config.anthropic.maxTokens,
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT_BASE,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Data context (frozen snapshot for this query):\n\n${contextBlock}`,
              cache_control: { type: 'ephemeral' },
            },
            {
              type: 'text',
              text: question,
            },
          ],
        },
      ],
    });

    const textBlock = response.content.find(
      (b): b is Anthropic.TextBlock => b.type === 'text',
    );
    if (!textBlock || textBlock.text.trim().length === 0) {
      return { ok: false, reason: 'AI returned no text content.' };
    }

    const usage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
    };
    const costUsd = computeCostUsd(config.anthropic.model, usage);

    // Persist usage for /usage reporting. Failures must not break the reply.
    try {
      await db.insert(aiUsageLogs).values({
        model: config.anthropic.model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheReadTokens,
        cacheCreationTokens: usage.cacheCreationTokens,
        costUsd: costUsd.toString(),
        feature: 'telegram_qna',
      });
    } catch (logErr) {
      logger.warn({ err: logErr }, 'Failed to persist ai_usage_logs row');
    }

    logger.debug({ accountCount, ...usage }, 'AI answer generated');
    return { ok: true, text: textBlock.text, usage };
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      logger.error({ err }, 'Anthropic auth failed');
      return { ok: false, reason: 'AI auth failed — check ANTHROPIC_API_KEY.' };
    }
    if (err instanceof Anthropic.RateLimitError) {
      return { ok: false, reason: 'AI rate-limited — try again in a minute.' };
    }
    if (err instanceof Anthropic.APIError) {
      logger.error({ err: err.message, status: err.status }, 'Anthropic API error');
      return { ok: false, reason: `AI error (${err.status}): ${err.message}` };
    }
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err }, 'AI call failed');
    return { ok: false, reason: `AI call failed: ${msg}` };
  }
}
