import { and, eq } from 'drizzle-orm';
import type { Context, Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import {
  answerQuestion,
  answerSheetsQuestion,
  detectCommandIntent,
  detectSheetsIntent,
} from './ai-handler.js';
import { buildUsageReport, renderUsageReport } from './usage-report.js';
import {
  approveOption,
  listPendingBatches,
} from './copy-fix-store.js';
import { recordAudit } from '../../lib/audit-logger.js';
import {
  listMetaAudiences,
} from '../11-auto-optimizer/index.js';
import {
  enqueue,
  executePending,
  findByShortId,
  findOnlyLivePending,
  formatConfirmation,
  formatMultiPendingNudge,
  formatPendingList,
  listLivePending,
  markApproved,
  markRejected,
  shortId,
  type ActionPayload,
  type ActionSummary,
} from '../12-approval-queue/index.js';
import { listPendingBatches as _ } from './copy-fix-store.js';
// (re-importing approveOption no longer needed here; approval flow lives in module 12)
import { db } from '../../db/index.js';
import { metaConnections } from '../../db/schema/meta-connections.js';
import { metaObjectSnapshots } from '../../db/schema/meta-object-snapshots.js';
import { logger } from '../../lib/logger.js';
import { TokenInvalidError } from '../../lib/auth-manager.js';
import {
  isAllowedChat,
  isApprover,
  rejectIfNotOwner,
  requireApprover,
  requireMember,
} from './auth.js';
import {
  fmtIdr,
  fmtPct,
  renderReportBlock,
  renderStatusBlock,
  trim,
} from './formatters.js';
import { escapeMd } from './notifications.js';
import {
  analyze,
  type DateRange,
  type Target,
} from '../02-ads-analysis/index.js';
import { pause, unpause } from '../03-start-stop-ads/index.js';
import {
  detectBudgetOwner,
  findFirstAdsetWithBudget,
  NoBudgetConfiguredError,
} from '../04-budget-control/index.js';
import { syncAccount } from '../01-manage-campaigns/index.js';
import {
  disableRule,
  enableRule,
  listLatestSnapshots as listRuleSnapshots,
} from '../07-rules-management/index.js';
import { config } from '../../config/env.js';
import {
  buildDailyReport,
  getReportForDate,
  getYesterdayReport,
  normalizeDateArg,
} from '../13-sheets-integration/index.js';
import {
  buildProgressBubbles,
  buildProgressData,
  wibHourLabel,
} from '../14-meta-progress/index.js';
import {
  buildCampaignRoasForRange,
  buildRoasReportForRange,
  formatRoasReport,
  recordClosing,
  resolveConnectionByAlias,
} from '../15-closing-tracker/index.js';
import {
  evaluateAlerts,
  formatMultipleResults,
  MIN_SPEND_IDR,
  type AlertWindow,
  type Business,
} from '../20-roas-alert/index.js';
import {
  handleAlertCommand,
  handleCabangCommand,
  handleCsCommand,
  handleRefreshCs,
  handleRoasCommand,
  handleTiktokCommand,
} from '../30-sheets-reader/index.js';
import { generateImageForTelegram } from '../05-kie-image-generator/index.js';
import {
  generateVideoForTelegram,
  generateImageToVideoForTelegram,
} from '../08-video-generator/index.js';
import { parseDateRange } from './date-args.js';

const TODAY_HELP =
  'Use ID accepted by Meta (15+ digit number) — copy from /status output.';

const COMMAND_LIST = [
  '/start - help & command list',
  '/accounts - list akun terhubung + total spend hari ini',
  '/status - active campaigns + spend hari ini',
  '/sync - trigger manual sync',
  '/report [periode|tanggal|range] - performance report (default 7d, e.g. /report 30d, /report 24Apr, /report 1Apr 15Apr)',
  '/pause [id] - pause campaign',
  '/resume [id] - resume campaign',
  '/budget [id] [amount_idr] - set daily budget (in rupiah)',
  '/top [range] - top 10 campaigns by aggregate ROAS (default 7d; min spend Rp 50.000)',
  '/worst [range] - worst 10 campaigns by aggregate ROAS (default 7d; min spend Rp 50.000)',
  '/rules - list automated rules',
  '/rule_enable [id] - enable a rule',
  '/rule_disable [id] - disable a rule',
  '/usage - estimasi biaya AI hari ini & bulan ini',
  '/drafts - lihat draft copy yang menunggu approval',
  '/approve_1 [id] - approve copy opsi 1 untuk campaign',
  '/approve_2 [id] - approve copy opsi 2',
  '/approve_3 [id] - approve copy opsi 3',
  '/audiences - list custom audience di Meta',
  '/create_audience engagement [30|60|90] - audience IG+FB engagers',
  '/create_audience lookalike [1|2|3] [source_id] - LAL X% dari source audience',
  '/create_audience database - info upload database jamaah',
  '/pending - list semua aksi yang menunggu approval',
  '/yes [id] - approve aksi pending tertentu',
  '/no [id] - reject aksi pending tertentu',
  '/yes all - approve SEMUA aksi pending sekaligus',
  '/no all - reject SEMUA aksi pending sekaligus',
  '/sheets - laporan Google Sheets data kemarin',
  '/sheets [tanggal] - laporan tanggal tertentu (mis. /sheets 24Apr)',
  '/progress - progress iklan hari ini (semua akun)',
  '/closing [qty] [revenue] [akun] - override manual (approver) — Sheets adalah sumber utama',
  '─── Sheets-reader (Tahap 2) ───',
  '/cs [nama] [periode] - performa CS dari tab CS PERFORM (default: today)',
  '/cabang [bisnis] [cabang] [periode] - agregat cabang dari REPORTING tab',
  '/roas [bisnis] [cabang] [periode] - ROAS dari kolom AN, no recalc',
  '/tiktok [cabang] [periode] - breakdown TikTok dari REPORTING tab',
  '/alert - cek threshold dari tab ALERT_CONFIG (auto-create kalau belum ada)',
  '/refresh_cs - bust cache CS (approver) — refresh dari Sheet next call',
  '─── Other ───',
  '/publish [variant_id] - publish copy variant approved jadi ad PAUSED (approver)',
  '/generate [deskripsi] - generate gambar iklan via KIE.ai GPT-4o (approver)',
  '/generate_umroh [deskripsi] - generate gambar iklan umroh dengan konteks Basmalah (approver)',
  '/video [deskripsi] - generate video iklan via KIE.ai Wan 2.7 (T2V, 720p/10s) (approver)',
  '/video_umroh [deskripsi] - generate video umroh dengan konteks Basmalah (approver)',
  '/video_image [deskripsi] - reply photo + command → image-to-video Wan 2.7 (approver)',
  '/alerts ⚠️ deprecated — pakai /alert (Sheets-based)',
];

export function registerCommands(bot: Telegraf): void {
  bot.start(async (ctx) => {
    if (await rejectIfNotOwner(ctx)) return;
    await ctx.reply(
      `Meta Ads Console Bot\n\nAvailable commands:\n${COMMAND_LIST.map((c) => `  ${c}`).join('\n')}`,
    );
  });

  // Read commands — anyone in an allowed chat (owner DM or group) can run.
  bot.command('accounts', wrap(handleAccounts));
  bot.command('status', wrap(handleStatus));
  bot.command('report', wrap(handleReport));
  bot.command('top', wrap(handleTop));
  bot.command('worst', wrap(handleWorst));
  bot.command('rules', wrap(handleRulesList));
  bot.command('usage', wrap(handleUsage));
  bot.command('drafts', wrap(handleDrafts));
  bot.command('audiences', wrap(handleAudiencesList));
  bot.command('pending', wrap(handlePendingList));
  bot.command('sheets', wrap(handleSheets));
  bot.command('progress', wrap(handleProgress));

  // ── New sheets-reader commands (Tahap 2 rebuild — 100% baca Sheets) ──
  bot.command('cs', wrap(handleCs));
  bot.command('cabang', wrap(handleCabang));
  bot.command('roas', wrap(handleRoasSheets));
  bot.command('tiktok', wrap(handleTiktok));
  bot.command('alert', wrap(handleAlert));
  bot.command('refresh_cs', wrap(handleRefreshCsCmd, { approver: true }));

  // ── Deprecated: old commands tetap diregister untuk transition window ──
  bot.command('alerts', wrap(handleAlertsDeprecated));

  // Write commands — only approvers (Bang Rian / Naila per .env list).
  bot.command('sync', wrap(handleSync, { approver: true }));
  bot.command('pause', wrap(handlePause, { approver: true }));
  bot.command('resume', wrap(handleResume, { approver: true }));
  bot.command('budget', wrap(handleBudget, { approver: true }));
  bot.command('rule_enable', wrap(handleRuleEnable, { approver: true }));
  bot.command('rule_disable', wrap(handleRuleDisable, { approver: true }));
  bot.command('create_audience', wrap(handleCreateAudience, { approver: true }));
  bot.command('approve_1', wrap((ctx, args) => handleApprove(ctx, args, 1), { approver: true }));
  bot.command('approve_2', wrap((ctx, args) => handleApprove(ctx, args, 2), { approver: true }));
  bot.command('approve_3', wrap((ctx, args) => handleApprove(ctx, args, 3), { approver: true }));
  bot.command('yes', wrap(handleYesById, { approver: true }));
  bot.command('no', wrap(handleNoById, { approver: true }));
  bot.command('closing', wrap(handleClosing, { approver: true }));
  bot.command('publish', wrap(handlePublish, { approver: true }));
  bot.command('generate', wrap(handleGenerate, { approver: true }));
  bot.command('generate_umroh', wrap(handleGenerateUmroh, { approver: true }));
  bot.command('video', wrap(handleVideo, { approver: true }));
  bot.command('video_umroh', wrap(handleVideoUmroh, { approver: true }));
  bot.command('video_image', wrap(handleVideoImage, { approver: true }));

  // Catch-all text handler. Order:
  //   1. Slash command? → already handled, skip
  //   2. Wrong chat? → silent ignore (don't reply to randoms)
  //   3. ya/tidak? → approver-only; non-approver gets the polite refusal
  //   4. Anything else → AI Q&A (members)
  bot.on(message('text'), async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith('/')) return;
    if (!isAllowedChat(ctx)) return;

    if (isAffirmative(text) || isNegative(text)) {
      if (!isApprover(ctx)) {
        // Di group: silent drop supaya "ya" antar manusia (mis. Rafi
        // ngobrol sama Naila) nggak ke-spam refusal-reply dari bot.
        // Di DM: tetap kasih polite refusal — DM ke bot pasti niat ke bot.
        if (ctx.chat?.type === 'private') {
          await ctx.reply(
            'Maaf, kamu tidak punya akses untuk aksi ini. Hubungi Bang Rian atau Naila.',
          );
        }
        return;
      }
      if (isAffirmative(text)) {
        await handleAffirmative(ctx);
      } else {
        await handleNegative(ctx);
      }
      return;
    }

    // Free-text intent routing — phrases like "gimana iklan" or "laporan
    // pagi" map to existing slash commands. Dispatch directly so we skip
    // the Claude round-trip when the user is really asking for a report.
    const intent = detectCommandIntent(text);
    if (intent) {
      switch (intent) {
        case 'progress':
          await handleProgress(ctx);
          return;
        case 'sheets':
          await handleSheets(ctx, []);
          return;
        case 'accounts':
          await handleAccounts(ctx);
          return;
        case 'status':
          await handleStatus(ctx);
          return;
      }
    }

    await handleNaturalLanguage(ctx, text);
  });
}

function isAffirmative(text: string): boolean {
  return /^(ya|yes|iya|ok|oke|okay)\s*[.!]?\s*$/i.test(text.trim());
}

function isNegative(text: string): boolean {
  return /^(tidak|no|batal|cancel|nggak|gak|ga)\s*[.!]?\s*$/i.test(text.trim());
}

/**
 * Strip "@<botUsername>" mention dari text supaya pertanyaan yang dikirim
 * ke Claude bersih. Mention bisa di awal, tengah, atau akhir — strip semua.
 */
function stripBotMention(text: string, botUsername: string | undefined): string {
  if (!botUsername) return text;
  const re = new RegExp(`@${botUsername}\\b`, 'gi');
  return text.replace(re, '').replace(/\s+/g, ' ').trim();
}

async function handleNaturalLanguage(ctx: Context, text: string): Promise<void> {
  if (!config.anthropic.isConfigured) {
    await ctx.reply(
      'AI Q&A is not configured on this bot. Use slash commands like /status, /report, /top.',
    );
    return;
  }

  // Bersihkan @bot mention sebelum kirim ke AI.
  const cleanText = stripBotMention(text, ctx.botInfo?.username);
  if (!cleanText) {
    await ctx.reply(
      'Halo! Tanyakan sesuatu setelah mention bot, contoh:\n' +
        '  @' + (ctx.botInfo?.username ?? 'bot') + ' bandingkan meta vs tiktok minggu ini\n' +
        '  @' + (ctx.botInfo?.username ?? 'bot') + ' siapa CS terbaik bulan ini?\n' +
        '  @' + (ctx.botInfo?.username ?? 'bot') + ' total revenue aqiqah bulan ini?',
    );
    return;
  }

  try {
    await ctx.sendChatAction('typing');
  } catch {
    // typing indicator is best-effort
  }

  // Sheets intent priority — pertanyaan tentang CS, channel breakdown,
  // trend, revenue dari Sheets jauh lebih akurat lewat Sheets context
  // (langsung baca angka dari source of truth) daripada Meta API context.
  const useSheets = detectSheetsIntent(cleanText);
  const result = useSheets
    ? await answerSheetsQuestion(cleanText)
    : await answerQuestion(cleanText);
  if (!result.ok) {
    await ctx.reply(`AI: ${result.reason}`);
    return;
  }
  logger.debug(
    {
      usage: result.usage,
      chars: result.text.length,
      route: useSheets ? 'sheets' : 'meta',
    },
    'AI Q&A response',
  );

  // Telegram caps a single message at 4096 chars; trim with margin and split
  // into chunks if needed so long answers still go through.
  const chunks = chunkText(result.text, 3800);
  for (const chunk of chunks) {
    await ctx.reply(chunk);
  }
}

function chunkText(s: string, maxLen: number): string[] {
  if (s.length <= maxLen) return [s];
  const out: string[] = [];
  let remaining = s;
  while (remaining.length > maxLen) {
    // Prefer to split at paragraph or newline boundary near the limit.
    const slice = remaining.slice(0, maxLen);
    const breakAt =
      slice.lastIndexOf('\n\n') > maxLen / 2
        ? slice.lastIndexOf('\n\n')
        : slice.lastIndexOf('\n') > maxLen / 2
          ? slice.lastIndexOf('\n')
          : maxLen;
    out.push(remaining.slice(0, breakAt).trimEnd());
    remaining = remaining.slice(breakAt).trimStart();
  }
  if (remaining.length > 0) out.push(remaining);
  return out;
}

// ---------- Wrapper for auth + error handling ----------

type Handler = (ctx: Context, args: string[]) => Promise<void>;

interface WrapOpts {
  /** When true, only Telegram users in TELEGRAM_APPROVED_USER_IDS may run
   *  this command. Use for anything that mutates Meta or persists writes. */
  approver?: boolean;
}

function wrap(fn: Handler, opts: WrapOpts = {}) {
  return async (ctx: Context) => {
    const ok = opts.approver ? await requireApprover(ctx) : await requireMember(ctx);
    if (!ok) return;
    const args = parseArgs(ctx);
    try {
      await fn(ctx, args);
    } catch (err) {
      if (err instanceof TokenInvalidError) {
        await ctx.reply(
          `🛑 Meta token invalid (${err.reason}). Owner must replace the token in Settings before further actions.`,
        );
        return;
      }
      logger.error({ err }, 'Telegram handler failed');
      const msg = err instanceof Error ? err.message : String(err);
      await ctx.reply(`Error: ${trim(msg, 300)}`);
    }
  };
}

function parseArgs(ctx: Context): string[] {
  const text =
    ctx.message && 'text' in ctx.message && typeof ctx.message.text === 'string'
      ? ctx.message.text
      : '';
  const parts = text.trim().split(/\s+/);
  return parts.slice(1);
}

// ---------- Connection helpers ----------

async function getActiveConnections() {
  return db
    .select()
    .from(metaConnections)
    .where(eq(metaConnections.status, 'active'));
}

/** Looks up which connection owns a given campaign id via the latest snapshot. */
async function findConnectionForCampaign(
  campaignId: string,
): Promise<Awaited<ReturnType<typeof getActiveConnections>>[number] | null> {
  const conns = await getActiveConnections();
  for (const c of conns) {
    const campaigns = await getActiveCampaignSnapshots(c.id);
    if (campaigns.some((s) => s.objectId === campaignId)) return c;
  }
  // Fall through: campaign id may be PAUSED or unknown — also check all snapshots.
  const [row] = await db
    .select()
    .from(metaObjectSnapshots)
    .where(
      and(
        eq(metaObjectSnapshots.objectType, 'campaign'),
        eq(metaObjectSnapshots.objectId, campaignId),
      ),
    )
    .limit(1);
  if (!row) return null;
  return conns.find((c) => c.id === row.connectionId) ?? null;
}

async function getActiveCampaignSnapshots(connectionId: string) {
  // Latest snapshot per campaign id, only those with status=ACTIVE.
  const rows = await db
    .select()
    .from(metaObjectSnapshots)
    .where(eq(metaObjectSnapshots.connectionId, connectionId));
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    if (r.objectType !== 'campaign') continue;
    const cur = latest.get(r.objectId);
    if (!cur || r.fetchedAt.getTime() > cur.fetchedAt.getTime()) {
      latest.set(r.objectId, r);
    }
  }
  return [...latest.values()].filter((r) => r.status === 'ACTIVE');
}

// ---------- /status ----------

async function handleStatus(ctx: Context): Promise<void> {
  const conns = await getActiveConnections();
  if (conns.length === 0) {
    await ctx.reply('No active accounts connected.');
    return;
  }
  const today = isoDateOffset(0);
  const range: DateRange = { since: today, until: today };

  let totalSpend = 0;
  let totalResults = 0;
  const sections: string[] = [];

  for (const conn of conns) {
    const campaigns = await getActiveCampaignSnapshots(conn.id);
    const accountHeader = `[${conn.accountName} - act_${conn.adAccountId}]`;

    if (campaigns.length === 0) {
      sections.push(`${accountHeader}\n- Tidak ada campaign aktif hari ini`);
      continue;
    }

    const targets: Target[] = campaigns.map((c) => ({ type: 'campaign', id: c.objectId }));
    const result = await analyze({ connectionId: conn.id, targets, range });
    totalSpend += result.rollup.spend;
    totalResults += result.rollup.results;

    // Sort campaigns within section by today's spend desc; cap to top 5.
    const sorted = [...result.perTarget].sort((a, b) => b.summary.spend - a.summary.spend);
    const TOP_N = 5;
    const shown = sorted.slice(0, TOP_N);
    const remaining = sorted.length - shown.length;
    const lines: string[] = [accountHeader];
    for (const t of shown) {
      const snap = campaigns.find((c) => c.objectId === t.target.id);
      const name = snap?.name ?? '(unknown)';
      lines.push(`- ${trim(name, 70)}`);
      lines.push(
        `  spend: ${fmtIdr(t.summary.spend)} | results: ${t.summary.results} | cpr: ${fmtIdr(t.summary.cpr)}`,
      );
    }
    if (remaining > 0) {
      lines.push(`(dan ${remaining} campaign lainnya)`);
    }
    sections.push(lines.join('\n'));
  }

  const header =
    `BASMALAH ADS CONTROL\n` +
    `Total: ${conns.length} akun aktif | Spend hari ini: ${fmtIdr(totalSpend)} | Results: ${totalResults}`;

  await sendChunked(ctx, `${header}\n\n${sections.join('\n\n')}`);
}

/**
 * Telegram messages are capped at 4096 chars. We split at paragraph
 * boundaries (double newline) to avoid breaking a campaign block in half,
 * and append "(lanjutan…)" / "(…lanjut)" markers.
 */
async function sendChunked(ctx: Context, text: string): Promise<void> {
  const MAX = 4000;
  if (text.length <= MAX) {
    await ctx.reply(text);
    return;
  }
  const blocks = text.split('\n\n');
  const chunks: string[] = [];
  let buf = '';
  for (const b of blocks) {
    const next = buf ? `${buf}\n\n${b}` : b;
    if (next.length > MAX && buf) {
      chunks.push(buf);
      buf = b.length > MAX ? trim(b, MAX) : b;
    } else {
      buf = next.length > MAX ? trim(next, MAX) : next;
    }
  }
  if (buf) chunks.push(buf);
  for (let i = 0; i < chunks.length; i++) {
    const prefix = i === 0 ? '' : '(lanjutan…)\n\n';
    await ctx.reply(prefix + chunks[i]);
  }
}

// ---------- /sync ----------

async function handleSync(ctx: Context): Promise<void> {
  const conns = await getActiveConnections();
  if (conns.length === 0) {
    await ctx.reply('No active accounts to sync.');
    return;
  }
  await ctx.reply(`🔄 Starting sync for ${conns.length} account(s)…`);

  // Fire and forget — sync can take minutes for large accounts.
  void (async () => {
    let ok = 0;
    let fail = 0;
    for (const c of conns) {
      try {
        const r = await syncAccount(c.id);
        ok += 1;
        await ctx.reply(
          `✅ ${c.accountName} synced — ${r.campaignCount} campaigns / ${r.adSetCount} ad sets / ${r.adCount} ads`,
        );
      } catch (err) {
        fail += 1;
        const msg = err instanceof Error ? err.message : String(err);
        await ctx.reply(
          `❌ ${c.accountName} — ${trim(msg, 200)}`,
        );
      }
    }
    await ctx.reply(`Sync complete — ${ok} ok, ${fail} failed.`);
  })();
}

// ---------- /report ----------

async function handleReport(ctx: Context, args: string[]): Promise<void> {
  const parsed = parseDateRange(args, { defaultDays: 7 });
  if (!parsed.ok) {
    await ctx.reply(
      `${parsed.reason}\n\n` +
        'Usage:\n' +
        '  /report             → 7 hari terakhir\n' +
        '  /report 30d         → 30 hari terakhir\n' +
        '  /report 24Apr       → tanggal tertentu\n' +
        '  /report 1Apr 15Apr  → range\n' +
        '  /report 2026-04-01 2026-04-15',
    );
    return;
  }
  const conns = await getActiveConnections();
  if (conns.length === 0) {
    await ctx.reply('No active accounts.');
    return;
  }
  const { since, until, label } = parsed.range;
  const range: DateRange = { since, until };

  let grandSpend = 0;
  let grandResults = 0;
  const sections: string[] = [];

  for (const conn of conns) {
    const campaigns = await getActiveCampaignSnapshots(conn.id);
    const accountHeader = `[${conn.accountName} - act_${conn.adAccountId}]`;

    if (campaigns.length === 0) {
      sections.push(`${accountHeader}\n- Tidak ada campaign aktif di window ini`);
      continue;
    }

    const targets: Target[] = campaigns.map((c) => ({ type: 'campaign', id: c.objectId }));
    const result = await analyze({ connectionId: conn.id, targets, range });
    grandSpend += result.rollup.spend;
    grandResults += result.rollup.results;

    const sorted = [...result.perTarget].sort((a, b) => b.summary.spend - a.summary.spend);
    const lines: string[] = [accountHeader];
    lines.push(
      `Subtotal: spend ${fmtIdr(result.rollup.spend)} | results ${result.rollup.results} | avg CPR ${fmtIdr(result.rollup.cpr)}`,
    );
    for (const t of sorted) {
      const snap = campaigns.find((c) => c.objectId === t.target.id);
      const name = snap?.name ?? '(unknown)';
      lines.push(`- ${trim(name, 70)}`);
      lines.push(
        `  spend: ${fmtIdr(t.summary.spend)} | cpr: ${fmtIdr(t.summary.cpr)} | ctr: ${fmtPct(t.summary.ctr)} | results: ${t.summary.results}`,
      );
    }
    sections.push(lines.join('\n'));
  }

  const grandCpr = grandResults > 0 ? grandSpend / grandResults : 0;
  const header =
    `BASMALAH ADS CONTROL — Laporan ${label}\n` +
    `Total: ${conns.length} akun | Spend ${fmtIdr(grandSpend)} | Results ${grandResults} | Avg CPR ${fmtIdr(grandCpr)}`;

  await sendChunked(ctx, `${header}\n\n${sections.join('\n\n')}`);
}

// ---------- /pause /resume ----------

async function handlePause(ctx: Context, args: string[]): Promise<void> {
  const id = args[0];
  if (!id) {
    await ctx.reply(`Usage: /pause <campaign_id>\n${TODAY_HELP}`);
    return;
  }
  const conn = await findConnectionForCampaign(id);
  if (!conn) {
    await ctx.reply(`Campaign ${id} tidak ditemukan di akun manapun.`);
    return;
  }
  const cname = await campaignNameOrId(conn.id, id);
  const pending = await enqueue({
    connectionId: conn.id,
    actionKind: 'pause',
    payload: { campaignId: id } as ActionPayload,
    summary: {
      actionLabel: 'Pause campaign',
      targetLabel: cname,
      detail: `Set status ACTIVE → PAUSED`,
      reason: 'Manual request via Telegram',
      accountName: conn.accountName,
    } as ActionSummary,
    requestedBy: 'telegram',
  });
  await ctx.reply(formatConfirmation(pending));
}

async function handleResume(ctx: Context, args: string[]): Promise<void> {
  const id = args[0];
  if (!id) {
    await ctx.reply(`Usage: /resume <campaign_id>\n${TODAY_HELP}`);
    return;
  }
  const conn = await findConnectionForCampaign(id);
  if (!conn) {
    await ctx.reply(`Campaign ${id} tidak ditemukan di akun manapun.`);
    return;
  }
  const cname = await campaignNameOrId(conn.id, id);
  const pending = await enqueue({
    connectionId: conn.id,
    actionKind: 'resume',
    payload: { campaignId: id } as ActionPayload,
    summary: {
      actionLabel: 'Resume campaign',
      targetLabel: cname,
      detail: `Set status PAUSED → ACTIVE`,
      reason: 'Manual request via Telegram',
      accountName: conn.accountName,
    } as ActionSummary,
    requestedBy: 'telegram',
  });
  await ctx.reply(formatConfirmation(pending));
}

// ---------- /budget ----------

async function handleBudget(ctx: Context, args: string[]): Promise<void> {
  const id = args[0];
  const rawAmount = args[1];
  if (!id || !rawAmount) {
    await ctx.reply(
      'Usage: /budget <campaign_id> <amount_idr>\nExample: /budget 12345... 100000  (= Rp 100,000/day)',
    );
    return;
  }
  const amountUnits = Number(rawAmount.replace(/[.,_]/g, ''));
  if (!Number.isFinite(amountUnits) || amountUnits <= 0) {
    await ctx.reply('Amount must be a positive number (rupiah).');
    return;
  }
  const newAmountMinor = Math.round(amountUnits * config.optimizer.currencyMinorPerUnit);

  const conn = await findConnectionForCampaign(id);
  if (!conn) {
    await ctx.reply(`Campaign ${id} tidak ditemukan di akun manapun.`);
    return;
  }

  // Resolve which object owns the budget:
  //   1. Try campaign-level (CBO).
  //   2. If campaign has no own budget, walk its adsets and pick the first
  //      one that has a budget (ABO).
  //   3. If neither has a budget, give up with a clear message.
  let resolvedTargetType: 'campaign' | 'adset';
  let resolvedTargetId: string;
  let currentMinor: number;
  let levelLabel: 'CBO' | 'ABO';

  try {
    const cboOwner = await detectBudgetOwner(conn.id, { type: 'campaign', id });
    // Campaign owns its budget — straightforward CBO path.
    resolvedTargetType = 'campaign';
    resolvedTargetId = cboOwner.ownerId;
    currentMinor = cboOwner.dailyBudgetMinor ?? cboOwner.lifetimeBudgetMinor ?? 0;
    levelLabel = 'CBO';
  } catch (err) {
    if (!(err instanceof NoBudgetConfiguredError)) throw err;
    // Campaign has no own budget — fall back to adset.
    const adsetMatch = await findFirstAdsetWithBudget(conn.id, id);
    if (!adsetMatch) {
      await ctx.reply(
        `🚫 Campaign ${id} tidak punya budget di campaign-level (CBO) maupun di adset-level (ABO). ` +
          `Set budget dulu via Meta Ads Manager sebelum bisa diubah dari sini.`,
      );
      return;
    }
    resolvedTargetType = 'adset';
    resolvedTargetId = adsetMatch.id;
    currentMinor = adsetMatch.dailyBudgetMinor ?? adsetMatch.lifetimeBudgetMinor ?? 0;
    levelLabel = 'ABO';
  }

  const factor = config.optimizer.currencyMinorPerUnit;
  const cname = await campaignNameOrId(conn.id, id);
  const targetLabel =
    resolvedTargetType === 'campaign'
      ? `${cname} (campaign-level / CBO)`
      : `${cname} → adset ${resolvedTargetId} (ABO)`;
  const pending = await enqueue({
    connectionId: conn.id,
    actionKind: 'budget',
    payload: {
      targetType: resolvedTargetType,
      targetId: resolvedTargetId,
      newAmountMinor,
    } as ActionPayload,
    summary: {
      actionLabel: `Ubah budget ${levelLabel}`,
      targetLabel,
      detail: `${fmtIdr(currentMinor / factor)} → ${fmtIdr(newAmountMinor / factor)} per hari`,
      reason: 'Manual request via Telegram',
      accountName: conn.accountName,
    } as ActionSummary,
    requestedBy: 'telegram',
  });
  await ctx.reply(formatConfirmation(pending));
}

async function campaignNameOrId(connectionId: string, campaignId: string): Promise<string> {
  const [row] = await db
    .select({ name: metaObjectSnapshots.name })
    .from(metaObjectSnapshots)
    .where(
      and(
        eq(metaObjectSnapshots.connectionId, connectionId),
        eq(metaObjectSnapshots.objectType, 'campaign'),
        eq(metaObjectSnapshots.objectId, campaignId),
      ),
    )
    .limit(1);
  return row?.name ?? campaignId;
}

// ---------- /top /worst (aggregate ROAS over a date range) ----------

const RANK_LIMIT = 10;

async function handleTop(ctx: Context, args: string[]): Promise<void> {
  await sendRanking(ctx, args, 'top');
}

async function handleWorst(ctx: Context, args: string[]): Promise<void> {
  await sendRanking(ctx, args, 'worst');
}

async function sendRanking(
  ctx: Context,
  args: string[],
  kind: 'top' | 'worst',
): Promise<void> {
  const parsed = parseDateRange(args, { defaultDays: 7 });
  if (!parsed.ok) {
    await ctx.reply(
      `${parsed.reason}\n\n` +
        `Usage:\n` +
        `  /${kind}             → 7 hari terakhir (default)\n` +
        `  /${kind} 30d         → 30 hari\n` +
        `  /${kind} 24Apr       → tanggal tertentu\n` +
        `  /${kind} 1Apr 15Apr  → range`,
    );
    return;
  }
  try {
    await ctx.sendChatAction('typing');
  } catch {
    // best-effort
  }

  const { since, until, label } = parsed.range;
  const rows = await buildCampaignRoasForRange({ since, until });

  // Min-spend filter: campaigns under Rp 50.000 in the window are too
  // small to rank meaningfully; drop them to keep the list signal-rich.
  const eligible = rows.filter((r) => r.spendIdr >= MIN_SPEND_IDR);

  // Top = highest ROAS first. We require revenue>0 since a 0-ROAS row
  // tells us the account has no Sheets revenue, not that the campaign
  // is bad.
  const sorted =
    kind === 'top'
      ? eligible
          .filter((r) => r.estimatedRevenueIdr > 0)
          .sort((a, b) => b.roas - a.roas)
      : // Worst = lowest ROAS first. Include 0-ROAS rows so accounts that
        // wasted spend without any attributed result float to the top.
        [...eligible].sort((a, b) => a.roas - b.roas);

  if (sorted.length === 0) {
    await ctx.reply(
      `Tidak ada campaign yang lolos filter min-spend Rp 50.000 di window ${label}.`,
    );
    return;
  }

  const top = sorted.slice(0, RANK_LIMIT);
  const title =
    kind === 'top'
      ? `🏆 TOP ${top.length} by aggregate ROAS — ${label}`
      : `⚠️ WORST ${top.length} by aggregate ROAS — ${label}`;
  const lines: string[] = [title, ''];
  for (let i = 0; i < top.length; i += 1) {
    const r = top[i]!;
    lines.push(
      `${i + 1}. ${trim(r.campaignName, 60)}  [${r.accountName}]`,
    );
    lines.push(
      `   ROAS: ${r.roas.toFixed(2)}x | Spend: ${fmtIdr(r.spendIdr)} | Rev: ${fmtIdr(r.estimatedRevenueIdr)} | Results: ${r.results}`,
    );
  }
  lines.push('');
  lines.push(`Filter: spend ≥ Rp 50.000 dalam window`);
  await sendChunked(ctx, lines.join('\n'));
}

// ---------- /accounts ----------

async function handleAccounts(ctx: Context): Promise<void> {
  const conns = await getActiveConnections();
  if (conns.length === 0) {
    await ctx.reply('No active accounts.');
    return;
  }
  const today = isoDateOffset(0);
  const range: DateRange = { since: today, until: today };

  interface AccountSummary {
    name: string;
    adAccountId: string;
    activeCampaigns: number;
    spendToday: number;
    resultsToday: number;
  }
  const summaries: AccountSummary[] = [];
  for (const conn of conns) {
    const campaigns = await getActiveCampaignSnapshots(conn.id);
    let spend = 0;
    let results = 0;
    if (campaigns.length > 0) {
      const targets: Target[] = campaigns.map((c) => ({ type: 'campaign', id: c.objectId }));
      const r = await analyze({ connectionId: conn.id, targets, range });
      spend = r.rollup.spend;
      results = r.rollup.results;
    }
    summaries.push({
      name: conn.accountName,
      adAccountId: conn.adAccountId,
      activeCampaigns: campaigns.length,
      spendToday: spend,
      resultsToday: results,
    });
  }

  const totalSpend = summaries.reduce((s, x) => s + x.spendToday, 0);
  const totalResults = summaries.reduce((s, x) => s + x.resultsToday, 0);
  const avgCpr = totalResults > 0 ? totalSpend / totalResults : 0;

  const lines: string[] = [];
  lines.push(`AKUN TERKONEKSI (${conns.length} akun)`);
  lines.push('');
  summaries.forEach((s, i) => {
    lines.push(`${i + 1}. ${s.name}`);
    lines.push(`   ID: act_${s.adAccountId}`);
    lines.push(
      `   Campaign aktif: ${s.activeCampaigns} | Spend hari ini: ${fmtIdr(s.spendToday)} | Results: ${s.resultsToday}`,
    );
    lines.push('');
  });
  lines.push(
    `TOTAL: Spend ${fmtIdr(totalSpend)} | Results ${totalResults} | CPR rata-rata ${fmtIdr(avgCpr)}`,
  );

  await ctx.reply(lines.join('\n'));
}

// ---------- /rules /rule_enable /rule_disable ----------

async function handleRulesList(ctx: Context): Promise<void> {
  const conn = (await getActiveConnections())[0];
  if (!conn) {
    await ctx.reply('No active accounts.');
    return;
  }
  const snaps = await listRuleSnapshots(conn.id);
  if (snaps.length === 0) {
    await ctx.reply('_No rules synced yet. Use the dashboard to create or refresh rules._');
    return;
  }
  const lines = snaps.map(
    (s) =>
      `• \`${s.ruleId}\` — ${trim(s.name, 60)} (${s.status})`,
  );
  await ctx.reply(`📜 Automated rules\n\n${lines.join('\n')}`);
}

async function handleRuleEnable(ctx: Context, args: string[]): Promise<void> {
  const id = args[0];
  if (!id) {
    await ctx.reply('Usage: /rule_enable <rule_id>');
    return;
  }
  const conn = (await getActiveConnections())[0];
  if (!conn) {
    await ctx.reply('No active accounts.');
    return;
  }
  await enableRule({
    connectionId: conn.id,
    ruleId: id,
    reason: 'Enabled via Telegram',
    actorId: 'telegram',
  });
  await ctx.reply(`✅ Rule \`${id}\` enabled.`);
}

async function handleRuleDisable(ctx: Context, args: string[]): Promise<void> {
  const id = args[0];
  if (!id) {
    await ctx.reply('Usage: /rule_disable <rule_id>');
    return;
  }
  const conn = (await getActiveConnections())[0];
  if (!conn) {
    await ctx.reply('No active accounts.');
    return;
  }
  await disableRule({
    connectionId: conn.id,
    ruleId: id,
    reason: 'Disabled via Telegram',
    actorId: 'telegram',
  });
  await ctx.reply(`⏸ Rule \`${id}\` disabled.`);
}

// ---------- /usage ----------

async function handleUsage(ctx: Context): Promise<void> {
  const report = await buildUsageReport();
  await ctx.reply(renderUsageReport(report));
}

// ---------- /drafts /approve_N ----------

async function handleDrafts(ctx: Context): Promise<void> {
  const batches = await listPendingBatches(15);
  if (batches.length === 0) {
    await ctx.reply('Tidak ada draft copy yang menunggu approval.');
    return;
  }
  const lines: string[] = [`📝 Pending draft copy (${batches.length} campaign)`, ''];
  for (const b of batches) {
    const when = b.optimizerRunAt.slice(0, 16).replace('T', ' ');
    lines.push(`• ${trim(b.campaignName, 50)}`);
    lines.push(`  ${b.variants.length} opsi · digenerate ${when}`);
    lines.push(`  /approve_1 ${b.campaignId}  ·  /approve_2 ${b.campaignId}  ·  /approve_3 ${b.campaignId}`);
    lines.push('');
  }
  await ctx.reply(lines.join('\n'));
}

async function handleApprove(
  ctx: Context,
  args: string[],
  optionIndex: 1 | 2 | 3,
): Promise<void> {
  const campaignId = args[0];
  if (!campaignId) {
    await ctx.reply(
      `Usage: /approve_${optionIndex} <campaign_id>\nLihat /drafts untuk daftar campaign yang ada draft.`,
    );
    return;
  }
  const conn = await findConnectionForCampaign(campaignId);
  if (!conn) {
    await ctx.reply(`Campaign ${campaignId} tidak ditemukan di akun manapun.`);
    return;
  }
  const cname = await campaignNameOrId(conn.id, campaignId);
  const pending = await enqueue({
    connectionId: conn.id,
    actionKind: 'copy_approve',
    payload: { campaignId, optionIndex } as ActionPayload,
    summary: {
      actionLabel: `Approve copy opsi ${optionIndex}`,
      targetLabel: cname,
      detail: `Mark draft opsi ${optionIndex} sebagai approved (lainnya di-reject)`,
      reason: 'Manual request via Telegram',
      accountName: conn.accountName,
    } as ActionSummary,
    requestedBy: 'telegram',
  });
  await ctx.reply(formatConfirmation(pending));
}

// ---------- /audiences /create_audience ----------

async function handleAudiencesList(ctx: Context): Promise<void> {
  const conn = (await getActiveConnections())[0];
  if (!conn) {
    await ctx.reply('No active accounts.');
    return;
  }
  const audiences = await listMetaAudiences(conn.id);
  if (audiences.length === 0) {
    await ctx.reply('_Belum ada custom audience di akun ini._');
    return;
  }
  const top = audiences.slice(0, 20);
  const lines: string[] = [`📋 Custom audiences (${audiences.length} total, showing ${top.length})`, ''];
  for (const a of top) {
    const count =
      a.approximateCount != null ? `~${a.approximateCount.toLocaleString('id-ID')}` : '?';
    const status = a.deliveryStatus ?? a.operationStatus ?? '';
    lines.push(`• ${trim(a.name, 60)}`);
    lines.push(`  id: \`${a.id}\``);
    lines.push(`  type: ${a.subtype ?? '?'} · count: ${count}${status ? ` · ${status}` : ''}`);
    lines.push('');
  }
  if (audiences.length > top.length) {
    lines.push(`+${audiences.length - top.length} lagi di Meta dashboard.`);
  }
  await ctx.reply(lines.join('\n'));
}

async function handleCreateAudience(ctx: Context, args: string[]): Promise<void> {
  const subcommand = (args[0] ?? '').toLowerCase();
  switch (subcommand) {
    case 'engagement':
      return createEngagement(ctx, args);
    case 'lookalike':
      return createLookalikeCmd(ctx, args);
    case 'database':
      await ctx.reply(
        '📁 *Database audience*\n\n' +
          'Upload CSV jamaah belum disupport via Telegram. Untuk sekarang:\n' +
          '1. Buka https://business.facebook.com/audiences\n' +
          '2. Create Audience → Customer List → upload CSV (email/phone hashed)\n\n' +
          'Versi otomatis akan ditambah kalau ada file storage backend.',
      );
      return;
    default:
      await ctx.reply(
        'Usage:\n' +
          '  /create_audience engagement [30|60|90]\n' +
          '  /create_audience lookalike [1|2|3] [source_audience_id]\n' +
          '  /create_audience database',
      );
  }
}

async function createEngagement(ctx: Context, args: string[]): Promise<void> {
  const daysRaw = args[1] ?? '60';
  const days = Number(daysRaw);
  if (![30, 60, 90].includes(days)) {
    await ctx.reply('Retention must be 30, 60, or 90 days.');
    return;
  }
  const conn = (await getActiveConnections())[0];
  if (!conn) {
    await ctx.reply('No active accounts.');
    return;
  }
  if (!conn.pageId && !conn.igBusinessId) {
    await ctx.reply(
      `🚫 Akun "${conn.accountName}" belum punya page_id / ig_business_id di database.`,
    );
    return;
  }
  const stamp = new Date().toISOString().slice(0, 10);
  const name = `${shortBrand(conn.accountName)} - Engagers ${days}D - ${stamp}`;
  const sources = [
    conn.igBusinessId ? `IG ${conn.igBusinessId}` : null,
    conn.pageId ? `FB ${conn.pageId}` : null,
  ]
    .filter(Boolean)
    .join(' + ');
  const pending = await enqueue({
    connectionId: conn.id,
    actionKind: 'audience_engagement',
    payload: { retentionDays: days as 30 | 60 | 90, name } as ActionPayload,
    summary: {
      actionLabel: 'Buat audience engagement',
      targetLabel: name,
      detail: `Sources: ${sources}, retention ${days} hari`,
      reason: 'Manual request via Telegram',
      accountName: conn.accountName,
    } as ActionSummary,
    requestedBy: 'telegram',
  });
  await ctx.reply(formatConfirmation(pending));
}

async function createLookalikeCmd(ctx: Context, args: string[]): Promise<void> {
  const pctRaw = args[1] ?? '';
  const sourceId = args[2] ?? '';
  const pct = Number(pctRaw);
  if (![1, 2, 3].includes(pct)) {
    await ctx.reply('Ratio must be 1, 2, or 3 (percent).');
    return;
  }
  if (!sourceId || !/^\d+$/.test(sourceId)) {
    await ctx.reply(
      'Usage: /create_audience lookalike [1|2|3] [source_audience_id]\n' +
        'Lihat /audiences untuk daftar source IDs.',
    );
    return;
  }
  const conn = (await getActiveConnections())[0];
  if (!conn) {
    await ctx.reply('No active accounts.');
    return;
  }
  const stamp = new Date().toISOString().slice(0, 10);
  const name = `${shortBrand(conn.accountName)} - LAL ${pct}% - ${sourceId} - ${stamp}`;
  const pending = await enqueue({
    connectionId: conn.id,
    actionKind: 'audience_lookalike',
    payload: {
      ratioPct: pct as 1 | 2 | 3,
      sourceAudienceId: sourceId,
      name,
    } as ActionPayload,
    summary: {
      actionLabel: 'Buat lookalike audience',
      targetLabel: name,
      detail: `LAL ${pct}% dari audience source ${sourceId}, country ID`,
      reason: 'Manual request via Telegram',
      accountName: conn.accountName,
    } as ActionSummary,
    requestedBy: 'telegram',
  });
  await ctx.reply(formatConfirmation(pending));
}

// ---------- /pending /yes /no + ya/tidak handlers ----------

async function handlePendingList(ctx: Context): Promise<void> {
  const items = await listLivePending();
  // sendChunked sebagai safety net — formatPendingList sudah cap 10 item
  // tapi kalau detail per-item masih panjang (mis. preview copy variant
  // dengan 240-char limit × 10 = 2.4KB+ headers), bisa nyaris kena 4096
  // limit. Chunk pakai paragraph break.
  await sendChunked(ctx, formatPendingList(items));
}

async function handleYesById(ctx: Context, args: string[]): Promise<void> {
  const id = args[0];
  if (!id) {
    await ctx.reply('Usage: /yes <id> atau /yes all\nLihat /pending untuk daftar.');
    return;
  }
  if (id.toLowerCase() === 'all') {
    await approveAllPending(ctx);
    return;
  }
  const row = await findByShortId(id);
  if (!row) {
    await ctx.reply(`Tidak ada pending action dengan id ${id} (mungkin sudah expired/diapprove).`);
    return;
  }
  await approveAndExecute(ctx, row.id);
}

async function handleNoById(ctx: Context, args: string[]): Promise<void> {
  const id = args[0];
  if (!id) {
    await ctx.reply('Usage: /no <id> atau /no all\nLihat /pending untuk daftar.');
    return;
  }
  if (id.toLowerCase() === 'all') {
    await rejectAllPending(ctx);
    return;
  }
  const row = await findByShortId(id);
  if (!row) {
    await ctx.reply(`Tidak ada pending action dengan id ${id}.`);
    return;
  }
  await markRejected(row.id, 'telegram');
  await ctx.reply(`❎ Aksi dibatalkan (${shortId(row)}).`);
}

async function approveAllPending(ctx: Context): Promise<void> {
  const all = await listLivePending();
  if (all.length === 0) {
    await ctx.reply('Tidak ada aksi yang menunggu approval.');
    return;
  }
  await ctx.reply(`▶️ Memproses ${all.length} aksi pending…`);
  let executed = 0;
  let failed = 0;
  let skipped = 0;
  const failures: string[] = [];
  for (const p of all) {
    const approved = await markApproved(p.id, 'telegram');
    if (!approved) {
      // Status changed between list and approve (e.g. expired or already decided).
      skipped += 1;
      continue;
    }
    try {
      const result = await executePending(approved);
      if (result.ok) {
        executed += 1;
      } else {
        failed += 1;
        const label = (approved.summary as ActionSummary).actionLabel;
        failures.push(`${shortId(approved)} ${label}: ${trim(result.message, 200)}`);
      }
    } catch (err) {
      // executePending only re-throws TokenInvalidError; bail to avoid
      // hammering Meta with a dead token.
      const msg = err instanceof Error ? err.message : String(err);
      failed += 1;
      failures.push(`${shortId(approved)} TOKEN INVALID: ${msg}`);
      break;
    }
  }
  const lines = [
    `Bulk approve selesai — ${executed} ok, ${failed} gagal, ${skipped} di-skip.`,
  ];
  if (failures.length > 0) {
    lines.push('');
    lines.push('Detail kegagalan:');
    for (const f of failures.slice(0, 10)) lines.push(`- ${f}`);
    if (failures.length > 10) lines.push(`(dan ${failures.length - 10} lainnya)`);
  }
  await ctx.reply(lines.join('\n'));
}

async function rejectAllPending(ctx: Context): Promise<void> {
  const all = await listLivePending();
  if (all.length === 0) {
    await ctx.reply('Tidak ada aksi yang menunggu — tidak ada yang dibatalkan.');
    return;
  }
  let rejected = 0;
  let skipped = 0;
  for (const p of all) {
    const r = await markRejected(p.id, 'telegram');
    if (r) rejected += 1;
    else skipped += 1;
  }
  const tail = skipped > 0 ? ` (${skipped} sudah berubah status, di-skip)` : '';
  await ctx.reply(`❎ ${rejected} aksi dibatalkan sekaligus${tail}.`);
}

async function handleAffirmative(ctx: Context): Promise<void> {
  const all = await listLivePending();
  if (all.length === 0) {
    await ctx.reply('Tidak ada aksi yang menunggu approval.');
    return;
  }
  if (all.length > 1) {
    await ctx.reply(formatMultiPendingNudge(all));
    return;
  }
  const only = await findOnlyLivePending();
  if (!only) {
    await ctx.reply('Pending sudah berubah; cek /pending.');
    return;
  }
  await approveAndExecute(ctx, only.id);
}

async function handleNegative(ctx: Context): Promise<void> {
  const all = await listLivePending();
  if (all.length === 0) {
    await ctx.reply('Tidak ada aksi yang menunggu — tidak ada yang dibatalkan.');
    return;
  }
  if (all.length > 1) {
    await ctx.reply(formatMultiPendingNudge(all));
    return;
  }
  const only = all[0]!;
  await markRejected(only.id, 'telegram');
  await ctx.reply(`❎ Aksi dibatalkan (${shortId(only)}: ${(only.summary as ActionSummary).actionLabel}).`);
}

async function approveAndExecute(ctx: Context, pendingId: string): Promise<void> {
  const approved = await markApproved(pendingId, 'telegram');
  if (!approved) {
    await ctx.reply('Pending tidak bisa di-approve (mungkin sudah berubah status).');
    return;
  }
  const result = await executePending(approved);
  await ctx.reply(result.message);
}

// ---------- /sheets ----------

async function handleSheets(ctx: Context, args: string[]): Promise<void> {
  try {
    await ctx.sendChatAction('typing');
  } catch {
    // best-effort
  }

  const report = await (async () => {
    if (args.length === 0) return getYesterdayReport();
    const iso = normalizeDateArg(args.join(' '));
    if (!iso) return null;
    return getReportForDate(iso);
  })();

  if (!report) {
    await ctx.reply(
      'Format tanggal tidak dikenali. Contoh: /sheets 24Apr atau /sheets 2026-04-24',
    );
    return;
  }

  await ctx.reply(buildDailyReport(report));
}

// ---------- /progress ----------

async function handleProgress(ctx: Context): Promise<void> {
  try {
    await ctx.sendChatAction('typing');
  } catch {
    // best-effort
  }
  const data = await buildProgressData();
  // Multi-bubble: one header bubble + one bubble per account, sent as
  // separate Telegram messages so each account is visually distinct in chat.
  const bubbles = buildProgressBubbles(data, wibHourLabel(new Date().getUTCHours()));
  await sendChunked(ctx, bubbles.header);
  for (const acct of bubbles.perAccount) {
    await sendChunked(ctx, acct);
  }
}

// ---------- /closing /roas ----------

async function handleClosing(ctx: Context, args: string[]): Promise<void> {
  const [qtyRaw, revenueRaw, ...aliasParts] = args;
  const alias = aliasParts.join(' ').trim();
  if (!qtyRaw || !revenueRaw || !alias) {
    await ctx.reply(
      'Usage: /closing <jumlah> <revenue_idr> <akun>\n' +
        'Contoh: /closing 3 75000000 basmalah\n' +
        '        (3 closing, Rp 75.000.000, akun Basmalah Travel)',
    );
    return;
  }
  const qty = Number(qtyRaw.replace(/[.,_]/g, ''));
  const revenue = Number(revenueRaw.replace(/[.,_]/g, ''));
  if (!Number.isInteger(qty) || qty <= 0) {
    await ctx.reply('Jumlah harus integer positif.');
    return;
  }
  if (!Number.isFinite(revenue) || revenue <= 0) {
    await ctx.reply('Revenue harus angka positif (rupiah, tanpa "Rp").');
    return;
  }
  const resolved = await resolveConnectionByAlias(alias);
  if (!resolved.ok) {
    if (resolved.reason === 'ambiguous') {
      await ctx.reply(
        `Alias "${alias}" cocok ke beberapa akun:\n${resolved.matches.map((m) => `  • ${m}`).join('\n')}\n` +
          `Pakai potongan nama yang lebih spesifik.`,
      );
    } else {
      await ctx.reply(`Tidak ada akun yang cocok dengan "${alias}".`);
    }
    return;
  }

  const conn = resolved.connection;
  const closingDate = isoDateOffset(0);
  const start = Date.now();
  try {
    const r = await recordClosing({
      connectionId: conn.id,
      closingDate,
      quantity: qty,
      revenueIdr: revenue,
      createdBy: `telegram:${ctx.from?.id ?? 'unknown'}`,
    });
    await recordAudit(
      {
        connectionId: conn.id,
        operationType: 'closing.record',
        targetType: 'closing',
        targetId: r.id,
        actorId: `telegram:${ctx.from?.id ?? 'unknown'}`,
        requestBody: { quantity: qty, revenueIdr: revenue, closingDate },
      },
      {
        status: 'success',
        responseBody: { id: r.id },
        durationMs: Date.now() - start,
      },
    );
    await ctx.reply(
      `✅ Closing dicatat\n` +
        `Akun: ${conn.accountName}\n` +
        `Tanggal: ${closingDate}\n` +
        `Quantity: ${qty}\n` +
        `Revenue: ${fmtIdr(revenue)}\n` +
        `Cek /roas untuk update ROAS.`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await recordAudit(
      {
        connectionId: conn.id,
        operationType: 'closing.record',
        targetType: 'closing',
        actorId: `telegram:${ctx.from?.id ?? 'unknown'}`,
        requestBody: { quantity: qty, revenueIdr: revenue, closingDate },
      },
      {
        status: 'failed',
        errorCode: 'closing_insert_failed',
        errorMessage: msg,
        durationMs: Date.now() - start,
      },
    );
    throw err;
  }
}

async function handleRoas(ctx: Context, args: string[]): Promise<void> {
  const parsed = parseDateRange(args, { defaultDays: 7 });
  if (!parsed.ok) {
    await ctx.reply(
      `${parsed.reason}\n\n` +
        'Usage:\n' +
        '  /roas               → 7 hari terakhir\n' +
        '  /roas 30d           → 30 hari terakhir\n' +
        '  /roas 24Apr         → tanggal tertentu\n' +
        '  /roas 1Apr 15Apr    → range\n' +
        '  /roas 2026-04-01 2026-04-15',
    );
    return;
  }
  try {
    await ctx.sendChatAction('typing');
  } catch {
    // best-effort
  }
  const { since, until, label } = parsed.range;
  const report = await buildRoasReportForRange({ since, until }, label);
  await sendChunked(ctx, formatRoasReport(report));
}

// ---------- /alerts ----------

const ALERT_WINDOWS: ReadonlySet<AlertWindow> = new Set([
  'daily',
  'weekly',
  'monthly',
]);
const ALERT_BUSINESSES: ReadonlySet<Business> = new Set([
  'basmalah',
  'aqiqah',
]);

interface ParsedAlertArgs {
  window: AlertWindow;
  businesses: Business[];
}

function parseAlertArgs(args: string[]): ParsedAlertArgs | { error: string } {
  let window: AlertWindow = 'daily';
  let business: Business | null = null;
  for (const raw of args) {
    const a = raw.toLowerCase();
    if (ALERT_WINDOWS.has(a as AlertWindow)) {
      window = a as AlertWindow;
      continue;
    }
    if (ALERT_BUSINESSES.has(a as Business)) {
      if (business !== null && business !== a) {
        return {
          error:
            `❌ Eh, jangan dua bisnis sekaligus dong\n` +
            `Pilih salah satu: basmalah ATAU aqiqah, atau kosongkan untuk cek dua-duanya.\n\n` +
            `Contoh benar:\n` +
            `  /alerts basmalah weekly\n` +
            `  /alerts weekly  (cek dua-duanya)`,
        };
      }
      business = a as Business;
      continue;
    }
    return {
      error:
        `❌ Argumen "${raw}" nggak dikenal\n` +
        `Yang valid: daily, weekly, monthly, basmalah, aqiqah\n` +
        `Ketik /alerts tanpa argumen untuk cek default.`,
    };
  }
  return {
    window,
    businesses: business !== null ? [business] : ['basmalah', 'aqiqah'],
  };
}

/**
 * @deprecated /alerts (pakai Meta API + proportional attribution) sudah
 * di-rebuild jadi /alert (Sheets-based) di module 30-sheets-reader.
 * Handler ini dipertahankan supaya transition smooth — kalau user lupa
 * masih ngetik /alerts, kasih jawaban + redirect.
 */
async function handleAlertsDeprecated(ctx: Context, args: string[]): Promise<void> {
  const parsed = parseAlertArgs(args);
  if ('error' in parsed) {
    await ctx.reply(
      `${parsed.error}\n\n` +
        `⚠️ /alerts sudah deprecated — pakai /alert (Sheets-based).`,
    );
    return;
  }
  try {
    await ctx.sendChatAction('typing');
  } catch {
    // typing indicator best-effort
  }

  const results = await Promise.all(
    parsed.businesses.map((b) => evaluateAlerts(b, parsed.window)),
  );
  const text =
    formatMultipleResults(results, { includeHealthyMessage: true }) ??
    `Belum ada data untuk window ${parsed.window}.`;
  await sendChunked(
    ctx,
    `⚠️ /alerts deprecated — versi baru: /alert\n\n${text}`,
  );
}

// ---------- New Sheets-reader command wrappers (Tahap 2) ----------
//
// Wrappers tipis: kerjaan parsing + rendering ada di
// src/modules/30-sheets-reader/commands.ts. Wrapper di sini cuma routing
// args ke handler dan kirim hasilnya ke Telegram.

async function handleCs(ctx: Context, args: string[]): Promise<void> {
  try {
    await ctx.sendChatAction('typing');
  } catch {
    // typing indicator best-effort
  }
  const text = await handleCsCommand(args);
  await sendChunked(ctx, text);
}

async function handleCabang(ctx: Context, args: string[]): Promise<void> {
  try {
    await ctx.sendChatAction('typing');
  } catch {
    // best-effort
  }
  const text = await handleCabangCommand(args);
  await sendChunked(ctx, text);
}

async function handleRoasSheets(ctx: Context, args: string[]): Promise<void> {
  try {
    await ctx.sendChatAction('typing');
  } catch {
    // best-effort
  }
  const text = await handleRoasCommand(args);
  await sendChunked(ctx, text);
}

async function handleTiktok(ctx: Context, args: string[]): Promise<void> {
  try {
    await ctx.sendChatAction('typing');
  } catch {
    // best-effort
  }
  const text = await handleTiktokCommand(args);
  await sendChunked(ctx, text);
}

async function handleAlert(ctx: Context, _args: string[]): Promise<void> {
  try {
    await ctx.sendChatAction('typing');
  } catch {
    // best-effort
  }
  const text = await handleAlertCommand();
  await sendChunked(ctx, text);
}

async function handleRefreshCsCmd(ctx: Context, _args: string[]): Promise<void> {
  const text = handleRefreshCs();
  await ctx.reply(text);
}

// ---------- /generate /generate_umroh ----------

const UMROH_PREFIX =
  'Konteks: iklan umroh untuk Basmalah Travel — agen perjalanan umroh Indonesia. ' +
  'Audience muslim 28-55 urban, tone tenang dan religius (jangan berlebihan). ' +
  'Visual fokus ke arsitektur Mekkah/Madinah, jamaah berihram, atau elemen umroh ' +
  'yang menggugah niat. Hindari elemen non-muslim atau distraksi visual.';

async function handleGenerate(ctx: Context, args: string[]): Promise<void> {
  const prompt = args.join(' ').trim();
  if (!prompt) {
    await ctx.reply(
      'Usage: /generate <deskripsi>\n' +
        'Contoh: /generate gambar iklan aqiqah kambing dengan background hijau islami',
    );
    return;
  }
  await runImageGeneration(ctx, { prompt, label: 'KIE Image' });
}

async function handleGenerateUmroh(ctx: Context, args: string[]): Promise<void> {
  const prompt = args.join(' ').trim();
  if (!prompt) {
    await ctx.reply(
      'Usage: /generate_umroh <deskripsi>\n' +
        'Contoh: /generate_umroh foto masjidil haram dengan teks promo umroh ramadan',
    );
    return;
  }
  await runImageGeneration(ctx, {
    prompt,
    contextPrefix: UMROH_PREFIX,
    label: 'KIE Image (Umroh)',
  });
}

interface RunImageOpts {
  prompt: string;
  label: string;
  contextPrefix?: string;
}

async function runImageGeneration(ctx: Context, opts: RunImageOpts): Promise<void> {
  await ctx.reply(
    `🎨 Generate gambar dimulai…\n` +
      `Prompt: ${trim(opts.prompt, 200)}\n` +
      `Estimasi: 30-90 detik. Saya kabari kalau sudah siap.`,
  );
  try {
    await ctx.sendChatAction('upload_photo');
  } catch {
    // best-effort
  }

  const actorId = `telegram:${ctx.from?.id ?? 'unknown'}`;
  const result = await generateImageForTelegram({
    prompt: opts.prompt,
    ...(opts.contextPrefix !== undefined ? { contextPrefix: opts.contextPrefix } : {}),
    actorId,
  });

  if (!result.ok) {
    await ctx.reply(`❌ Generate gagal: ${result.reason}`);
    return;
  }
  if (result.resultUrls.length === 0) {
    await ctx.reply(
      `⚠️ Generate sukses tapi KIE tidak return URL. Asset id: ${result.asset.id}`,
    );
    return;
  }

  // Kirim image utama via Telegram (URL — Telegram fetch sendiri).
  const caption =
    `✅ ${opts.label}\n` +
    `Asset id: ${result.asset.id}\n` +
    `Took: ${(result.durationMs / 1000).toFixed(1)}s (${result.attempts} polls)\n` +
    `Prompt: ${trim(opts.prompt, 300)}`;
  try {
    await ctx.replyWithPhoto(
      { url: result.resultUrls[0]! },
      { caption },
    );
  } catch (err) {
    // Photo send fail (URL tidak reachable Telegram, etc.) — fall back ke text.
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err, asset: result.asset.id }, 'replyWithPhoto failed, falling back to URL text');
    await ctx.reply(
      `${caption}\n\n⚠️ Telegram nggak bisa fetch foto-nya, ini URL langsung:\n${result.resultUrls[0]}\n\n(${msg})`,
    );
  }

  // Variant images extra (kalau ada).
  if (result.resultUrls.length > 1) {
    await ctx.reply(
      `+${result.resultUrls.length - 1} varian lain:\n${result.resultUrls.slice(1).join('\n')}`,
    );
  }
}

// ---------- /video /video_umroh /video_image ----------

const VIDEO_AQIQAH_PREFIX =
  'Konteks: video iklan aqiqah untuk Aqiqah Express — layanan aqiqah premium. ' +
  'Audience muslim 25-50 urban, tone hangat dan family-oriented. Visual fokus ' +
  'ke proses pemotongan halal, hidangan kambing yang menggugah, atau momen ' +
  'keluarga menikmati aqiqah. Hindari elemen non-halal atau gore.';

const VIDEO_UMROH_PREFIX =
  'Konteks: video iklan umroh untuk Basmalah Travel — agen perjalanan umroh. ' +
  'Audience muslim 28-55 urban, tone tenang dan religius. Visual fokus ke ' +
  'arsitektur Mekkah/Madinah, jamaah berihram, momen tawaf yang khusyuk. ' +
  'Hindari elemen non-muslim atau distraksi visual.';

async function handleVideo(ctx: Context, args: string[]): Promise<void> {
  const prompt = args.join(' ').trim();
  if (!prompt) {
    await ctx.reply(
      'Usage: /video <deskripsi>\n' +
        'Contoh: /video iklan aqiqah keluarga muslim di rumah dengan hidangan kambing',
    );
    return;
  }
  await runVideoGeneration(ctx, {
    kind: 'text_to_video',
    prompt,
    contextPrefix: VIDEO_AQIQAH_PREFIX,
    label: 'KIE Video (Aqiqah)',
  });
}

async function handleVideoUmroh(ctx: Context, args: string[]): Promise<void> {
  const prompt = args.join(' ').trim();
  if (!prompt) {
    await ctx.reply(
      'Usage: /video_umroh <deskripsi>\n' +
        'Contoh: /video_umroh jamaah tawaf di Masjidil Haram saat sunset',
    );
    return;
  }
  await runVideoGeneration(ctx, {
    kind: 'text_to_video',
    prompt,
    contextPrefix: VIDEO_UMROH_PREFIX,
    label: 'KIE Video (Umroh)',
  });
}

/**
 * /video_image: image-to-video Wan 2.7. Operator harus REPLY ke message
 * yang berisi photo, lalu jalankan command. First frame video = photo
 * yang di-reply; prompt = arg ke command.
 */
async function handleVideoImage(ctx: Context, args: string[]): Promise<void> {
  const prompt = args.join(' ').trim();
  if (!prompt) {
    await ctx.reply(
      'Usage: reply ke pesan yang ada photo, lalu ketik /video_image <deskripsi gerakan>\n' +
        'Contoh: /video_image kamera zoom-in pelan ke wajah subjek dengan motion blur',
    );
    return;
  }

  const replyMsg = (ctx.message as { reply_to_message?: { photo?: Array<{ file_id: string }> } } | undefined)
    ?.reply_to_message;
  const photos = replyMsg?.photo;
  if (!photos || photos.length === 0) {
    await ctx.reply(
      '⚠️ Command ini harus reply ke pesan yang ada photo. Telegram-nya nggak nemu attachment.',
    );
    return;
  }
  // Photo array sorted by size; ambil yang terbesar.
  const largest = photos[photos.length - 1];
  if (!largest) {
    await ctx.reply('⚠️ Photo array kosong (Telegram payload aneh).');
    return;
  }

  let firstFrameUrl: string;
  try {
    const link = await ctx.telegram.getFileLink(largest.file_id);
    firstFrameUrl = link.toString();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await ctx.reply(`⚠️ Gagal ambil URL photo dari Telegram: ${msg}`);
    return;
  }

  await runVideoGeneration(ctx, {
    kind: 'image_to_video',
    prompt,
    firstFrameUrl,
    label: 'KIE Video (I2V)',
  });
}

type RunVideoOpts =
  | {
      kind: 'text_to_video';
      prompt: string;
      contextPrefix?: string;
      label: string;
    }
  | {
      kind: 'image_to_video';
      prompt: string;
      firstFrameUrl: string;
      label: string;
    };

async function runVideoGeneration(ctx: Context, opts: RunVideoOpts): Promise<void> {
  await ctx.reply(
    `⏳ Generate video dimulai...\n` +
      `Prompt: ${trim(opts.prompt, 200)}\n` +
      `Estimasi: 3-7 menit. Saya kabari kalau sudah siap.`,
  );
  try {
    await ctx.sendChatAction('upload_video');
  } catch {
    // best-effort
  }

  const actorId = `telegram:${ctx.from?.id ?? 'unknown'}`;
  const result =
    opts.kind === 'text_to_video'
      ? await generateVideoForTelegram({
          prompt: opts.prompt,
          ...(opts.contextPrefix !== undefined ? { contextPrefix: opts.contextPrefix } : {}),
          actorId,
        })
      : await generateImageToVideoForTelegram({
          prompt: opts.prompt,
          firstFrameUrl: opts.firstFrameUrl,
          actorId,
        });

  if (!result.ok) {
    await ctx.reply(`❌ Generate video gagal: ${result.reason}`);
    return;
  }
  if (result.resultUrls.length === 0) {
    await ctx.reply(
      `⚠️ Generate sukses tapi KIE tidak return URL. Asset id: ${result.asset.id}`,
    );
    return;
  }

  const caption =
    `✅ ${opts.label}\n` +
    `Asset id: ${result.asset.id}\n` +
    `Took: ${(result.durationMs / 1000).toFixed(1)}s (${result.attempts} polls)\n` +
    `Prompt: ${trim(opts.prompt, 300)}`;
  // Poller men-download mp4 ke /root/meta-ads-dev/data/assets/videos/.
  // resultUrls[0] adalah local path (kalau download sukses) atau URL
  // KIE asli (kalau download gagal). Telegraf butuh shape berbeda:
  // local file → { source }, http URL → { url }.
  const target = result.resultUrls[0]!;
  const sendInput = /^https?:\/\//i.test(target)
    ? { url: target }
    : { source: target };
  try {
    await ctx.replyWithVideo(sendInput, { caption });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err, asset: result.asset.id }, 'replyWithVideo failed, falling back to URL text');
    await ctx.reply(
      `${caption}\n\n⚠️ Telegram nggak bisa kirim video-nya, sumber:\n${target}\n\n(${msg})`,
    );
  }
}

// ---------- /publish ----------

async function handlePublish(ctx: Context, args: string[]): Promise<void> {
  const variantId = args[0];
  if (!variantId) {
    await ctx.reply(
      'Usage: /publish <variant_id>\n' +
        'Variant harus berstatus approved (lihat /drafts dan /approve_N dulu).',
    );
    return;
  }
  const { enqueuePublishAd } = await import('../16-ad-publisher/index.js');
  const r = await enqueuePublishAd({
    variantId,
    requestedBy: `telegram:${ctx.from?.id ?? 'unknown'}`,
  });
  if (!r.ok) {
    await ctx.reply(`🚫 ${r.reason}`);
    return;
  }
  // Custom confirmation: the queue's default formatter prefixes everything
  // with "Detail:" which collapses our multi-line preview. Render the
  // ad-specific shape the operator asked for, then point at /yes <id>.
  const s = r.pending.summary as ActionSummary;
  const expiresMs = r.pending.expiresAt.getTime() - Date.now();
  const expiresHours = Math.max(0, Math.floor(expiresMs / (60 * 60 * 1000)));
  await ctx.reply(
    `${s.actionLabel}\n${s.detail}\n\n` +
      `ID: ${shortId(r.pending)}  ·  expires: ${expiresHours}h\n` +
      `Ketik 'ya' untuk lanjut atau 'tidak' untuk batal`,
  );
}

// ---------- helpers ----------

/** Short prefix for audience names: "Bang Rian Console Iklan" → "BRCI". */
function shortBrand(accountName: string): string {
  const initials = accountName
    .replace(/[^A-Za-z\s-]/g, '')
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((w) => (w[0] ?? '').toUpperCase())
    .join('');
  return initials.slice(0, 5) || 'AC';
}

function isoDateOffset(daysFromToday: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromToday);
  return d.toISOString().slice(0, 10);
}
