import { eq } from 'drizzle-orm';
import {
  appConfig as config,
  db,
  logger,
  notifyOwner,
  recordAudit,
  TokenInvalidError,
} from '../00-foundation/index.js';
import { copyVariants } from '../../db/schema/copy-variants.js';
import { metaConnections } from '../../db/schema/meta-connections.js';
import {
  detectBudgetOwner,
  findFirstAdsetWithBudget,
  NoBudgetConfiguredError,
} from '../04-budget-control/index.js';
import {
  generateAiVariantsForBadAd,
  type BadAdContext,
} from '../06-copywriting-lab/index.js';
import { detectBrand } from '../14-meta-progress/index.js';
import {
  enqueue,
  formatConfirmation,
  type ActionPayload,
  type ActionSummary,
} from '../12-approval-queue/index.js';
import type {
  OptimizerDecision,
  OptimizerExecutionResult,
} from './schema.js';

export interface ExecuteOpts {
  connectionId: string;
  /** When true, skip Meta writes; still notify. */
  notifyOnly?: boolean;
}

/**
 * Applies a single optimizer decision. Pre-action notification, action,
 * post-action notification. All Meta writes pass through audit-logger
 * via module 03/04 helpers, so the audit trail is automatic.
 */
export async function executeDecision(
  decision: OptimizerDecision,
  opts: ExecuteOpts,
): Promise<OptimizerExecutionResult> {
  switch (decision.kind) {
    case 'auto_pause':
      return runAutoPause(decision, opts);
    case 'auto_scale':
      return runAutoScale(decision, opts);
    case 'cpr_alert':
      return runCprAlert(decision, opts);
    case 'resume_notify':
      return runResumeNotify(decision);
    case 'copy_fix_suggestion':
      return runCopyFixSuggestion(decision, opts);
    default:
      return {
        decision,
        outcome: 'skipped',
        detail: `Unknown decision kind: ${(decision as { kind: string }).kind}`,
      };
  }
}

async function runCopyFixSuggestion(
  decision: OptimizerDecision,
  opts: ExecuteOpts,
): Promise<OptimizerExecutionResult> {
  if (opts.notifyOnly) {
    return { decision, outcome: 'notified_only', detail: 'notify-only mode' };
  }

  // Derive brand dari accountName supaya AI generator pakai system prompt
  // yang relevan (aqiqah vs basmalah). Kalau lookup gagal, biarin
  // generator pakai default 'basmalah' — backward-compat.
  const [conn] = await db
    .select({ accountName: metaConnections.accountName })
    .from(metaConnections)
    .where(eq(metaConnections.id, opts.connectionId))
    .limit(1);
  const brand = conn ? detectBrand(conn.accountName) : undefined;

  const ctx: BadAdContext = {
    campaignId: decision.campaignId,
    campaignName: decision.campaignName,
    objective: null, // not on the decision; AI prompt tolerates null
    cprIdr: decision.metrics.cprIdr ?? 0,
    cprThresholdIdr: config.optimizer.autoPauseCprIdr,
    spendIdr: decision.metrics.spendIdr ?? 0,
    results: decision.metrics.results ?? 0,
    ctrPct: decision.metrics.ctrPct ?? 0,
    ageDays: decision.metrics.ageDays != null ? decision.metrics.ageDays : null,
    resultActionType: null,
    ...(brand !== undefined ? { brand } : {}),
  };

  const gen = await generateAiVariantsForBadAd(ctx);
  if (!gen.ok) {
    await notifyOwner(
      `⚠️ Copy fix gagal untuk ${decision.campaignName}: ${gen.reason}`,
    );
    await recordAudit(
      {
        connectionId: opts.connectionId,
        operationType: 'copy.fix.failed',
        targetType: 'campaign',
        targetId: decision.campaignId,
        actorId: 'auto-optimizer',
        requestBody: { reason: decision.reason, error: gen.reason },
      },
      { status: 'failed', errorCode: 'ai_generation_failed', errorMessage: gen.reason, durationMs: 0 },
    );
    return { decision, outcome: 'failed', detail: gen.reason };
  }

  const optimizerRunAt = new Date().toISOString();
  const draftIds: string[] = [];
  for (let i = 0; i < gen.data.variants.length; i += 1) {
    const v = gen.data.variants[i];
    if (!v) {
      logger.warn(
        { campaignId: decision.campaignId, index: i },
        'Skipping undefined variant in copy fix output',
      );
      continue;
    }
    const rationale = gen.data.rationales[i] ?? '';
    const [row] = await db
      .insert(copyVariants)
      .values({
        connectionId: opts.connectionId,
        briefId: null,
        parentId: null,
        version: 1,
        strategy: 'manual',
        status: 'draft',
        primaryText: v.primaryText,
        headline: v.headline,
        cta: v.cta,
        language: v.language ?? 'id',
        metadata: {
          source: 'copy_fix_suggestion',
          campaignId: decision.campaignId,
          campaignName: decision.campaignName,
          optimizerRunAt,
          optionIndex: i + 1,
          rationale,
          promptCprIdr: ctx.cprIdr,
          promptResults: ctx.results,
        } as never,
        createdBy: 'auto-optimizer',
      })
      .returning({ id: copyVariants.id });
    if (row) draftIds.push(row.id);
  }

  await recordAudit(
    {
      connectionId: opts.connectionId,
      operationType: 'copy.fix.generated',
      targetType: 'campaign',
      targetId: decision.campaignId,
      actorId: 'auto-optimizer',
      requestBody: {
        reason: decision.reason,
        cprIdr: ctx.cprIdr,
        cprThreshold: ctx.cprThresholdIdr,
      },
    },
    {
      status: 'success',
      responseBody: { draftIds, optimizerRunAt },
      durationMs: 0,
    },
  );

  await notifyOwner(
    formatSuggestionMessage(decision, ctx, gen.data.variants, gen.data.audienceSuggestion),
  );

  return {
    decision,
    outcome: 'executed',
    detail: `${draftIds.length} draft variants saved`,
  };
}

function formatSuggestionMessage(
  decision: OptimizerDecision,
  ctx: BadAdContext,
  variants: Array<{ primaryText: string; headline: string; cta: string }>,
  audienceSuggestion: string,
): string {
  const cprFmt = `Rp ${Math.round(ctx.cprIdr).toLocaleString('id-ID')}`;
  const lines: string[] = [];
  lines.push(`⚠️ ${decision.campaignName}`);
  lines.push(`CPR ${cprFmt} — perlu perbaikan`);
  lines.push('');
  lines.push('Saran copy baru:');
  lines.push('');
  variants.forEach((v, i) => {
    lines.push(`OPSI ${i + 1}:`);
    lines.push(`Primary: ${v.primaryText}`);
    lines.push(`Headline: ${v.headline}`);
    lines.push(`CTA: ${v.cta}`);
    lines.push('');
  });
  lines.push(
    `Ketik /approve_1 ${decision.campaignId} atau /approve_2 ${decision.campaignId} ` +
      `atau /approve_3 ${decision.campaignId} untuk simpan copy ini sebagai draft approved.`,
  );
  lines.push('');
  lines.push(`💡 Saran audience: ${audienceSuggestion}`);
  lines.push(`Lihat /audiences untuk source ID, lalu /create_audience lookalike 1 [id] dst.`);
  return lines.join('\n');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function runAutoPause(
  decision: OptimizerDecision,
  opts: ExecuteOpts,
): Promise<OptimizerExecutionResult> {
  if (opts.notifyOnly) {
    return { decision, outcome: 'notified_only', detail: 'notify-only mode' };
  }
  const accountName = await accountNameOrId(opts.connectionId);
  const pending = await enqueue({
    connectionId: opts.connectionId,
    actionKind: 'auto_pause',
    payload: { campaignId: decision.campaignId } as ActionPayload,
    summary: {
      actionLabel: 'Auto-pause campaign (CPR tinggi)',
      targetLabel: decision.campaignName,
      detail: 'Set status ACTIVE → PAUSED',
      reason: decision.reason,
      accountName,
    } as ActionSummary,
    requestedBy: 'auto-optimizer',
  });
  await notifyOwner(formatConfirmation(pending));
  return {
    decision,
    outcome: 'notified_only',
    detail: `enqueued for approval (id ${pending.id.slice(0, 8)})`,
  };
}

async function runAutoScale(
  decision: OptimizerDecision,
  opts: ExecuteOpts,
): Promise<OptimizerExecutionResult> {
  if (opts.notifyOnly) {
    return { decision, outcome: 'notified_only', detail: 'notify-only mode' };
  }

  // Pre-flight: cek di mana budget tinggal supaya approve nanti nggak
  // surprise operator dengan "cannot detect owner" yang ambigu.
  //
  // Flow:
  //   1. Coba campaign-level read → kalau ada budget (CBO normal) → lanjut.
  //   2. Kalau campaign-level kosong (NoBudgetConfiguredError):
  //      a. Probe semua adset di bawah campaign — kalau ada satu yang
  //         punya budget → ABO (budget per-adset), skip karena auto-scale
  //         nggak men-target adset spesifik.
  //      b. Kalau semua adset juga kosong → CBO yang Meta-API-nya nggak
  //         return budget (kemungkinan budget di-set manual via Ads
  //         Manager dengan format yang Meta nggak expose ke Graph API).
  //         Skip dengan pesan informatif.
  //   3. Error lain (token invalid, network) → re-throw / generic skip.
  let owner;
  try {
    owner = await detectBudgetOwner(opts.connectionId, {
      type: 'campaign',
      id: decision.campaignId,
    });
  } catch (err) {
    if (err instanceof TokenInvalidError) throw err;
    if (err instanceof NoBudgetConfiguredError) {
      // Probe adsets — distinguish ABO vs broken-CBO.
      const adsetWithBudget = await findFirstAdsetWithBudget(
        opts.connectionId,
        decision.campaignId,
      );
      let msg: string;
      if (adsetWithBudget) {
        // ABO — budget tinggal di adset, auto-scale nggak men-target adset spesifik.
        msg =
          `⚠️ Skip scale ${decision.campaignName}: campaign pakai ABO ` +
          `(budget per-adset). Auto-scale tidak men-target adset spesifik. ` +
          `Pakai /budget [adset_id] [amount] untuk adjust manual.`;
      } else {
        // Broken-CBO — Meta API nggak return budget meski campaign punya
        // CBO. Kemungkinan budget di-set manual atau format yang Graph
        // tidak expose. Operator perlu cek di Ads Manager.
        msg =
          `⚠️ Skip scale ${decision.campaignName}: Campaign menggunakan CBO. ` +
          `Budget diset manual di Ads Manager untuk campaign ini.`;
      }
      await notifyOwner(msg);
      return { decision, outcome: 'skipped', detail: msg };
    }
    // Unknown error — preserve original generic skip behavior.
    const msg = err instanceof Error ? err.message : String(err);
    await notifyOwner(`⚠️ Skip scale (cannot detect owner): ${msg}`);
    return { decision, outcome: 'skipped', detail: msg };
  }
  if (owner.ownerType !== 'campaign' || owner.ownerId !== decision.campaignId) {
    const msg =
      `⚠️ Skip scale ${decision.campaignName}: budget owner adalah ` +
      `${owner.ownerType} ${owner.ownerId} (ABO). Auto-scale nggak men-target adset.`;
    await notifyOwner(msg);
    return { decision, outcome: 'skipped', detail: msg };
  }

  const factor = config.optimizer.currencyMinorPerUnit;
  const currentMinor = owner.dailyBudgetMinor ?? owner.lifetimeBudgetMinor ?? 0;
  const newMinor = Math.floor(currentMinor * 1.2);
  const accountName = await accountNameOrId(opts.connectionId);
  const pending = await enqueue({
    connectionId: opts.connectionId,
    actionKind: 'auto_scale',
    payload: { campaignId: decision.campaignId, pct: 20 } as ActionPayload,
    summary: {
      actionLabel: 'Auto-scale budget +20%',
      targetLabel: decision.campaignName,
      detail:
        `Rp ${Math.round(currentMinor / factor).toLocaleString('id-ID')} → ` +
        `Rp ${Math.round(newMinor / factor).toLocaleString('id-ID')}`,
      reason: decision.reason,
      accountName,
    } as ActionSummary,
    requestedBy: 'auto-optimizer',
  });
  await notifyOwner(formatConfirmation(pending));
  return {
    decision,
    outcome: 'notified_only',
    detail: `enqueued for approval (id ${pending.id.slice(0, 8)})`,
  };
}

async function accountNameOrId(connectionId: string): Promise<string> {
  const [row] = await db
    .select({ name: metaConnections.accountName })
    .from(metaConnections)
    .where(eq(metaConnections.id, connectionId))
    .limit(1);
  return row?.name ?? connectionId;
}

async function runCprAlert(
  decision: OptimizerDecision,
  opts: ExecuteOpts,
): Promise<OptimizerExecutionResult> {
  const accountName = await accountNameOrId(opts.connectionId);
  await notifyOwner(
    `⚠️ CPR alert — [${accountName}]\n` +
      `Campaign: ${decision.campaignName}\n` +
      `Reason: ${decision.reason}\n` +
      `id: ${decision.campaignId}`,
  );
  return { decision, outcome: 'notified_only', detail: 'CPR alert sent' };
}

async function runResumeNotify(
  decision: OptimizerDecision,
): Promise<OptimizerExecutionResult> {
  await notifyOwner(
    `🔔 Review needed — ${decision.campaignName}\n` +
      `Status: ${decision.reason}\n` +
      `Use /resume ${decision.campaignId} to reactivate, or leave paused.`,
  );
  return { decision, outcome: 'notified_only', detail: 'review notification sent' };
}

function preMessage(prefix: string, d: OptimizerDecision): string {
  return (
    `${prefix} candidate — ${d.campaignName}\n` +
    `Reason: ${d.reason}\n` +
    `id: \`${d.campaignId}\` · evaluating…`
  );
}

// re-export so callers can log it
export { logger };
