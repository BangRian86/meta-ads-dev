import { logger } from '../00-foundation/index.js';
import { TokenInvalidError } from '../00-foundation/index.js';
import { pause, unpause } from '../03-start-stop-ads/index.js';
import {
  decreaseBudget,
  detectBudgetOwner,
  increaseBudget,
} from '../04-budget-control/index.js';
import {
  createLookalike,
  createMultiSourceEngagementAudience,
} from '../18-audience-builder/index.js';
import { approveOption } from '../06-copywriting-lab/index.js';
import { executePublishAd } from '../16-ad-publisher/index.js';
import { markExecuted, markFailed } from './store.js';
import type { PendingAction } from '../../db/schema/pending-actions.js';
import type {
  ActionKind,
  AudienceEngagementPayload,
  AudienceLookalikePayload,
  AutoScalePayload,
  BudgetPayload,
  CopyApprovePayload,
  PausePayload,
  PublishAdPayload,
  ResumePayload,
} from './schema.js';

export interface ExecuteOutcome {
  ok: boolean;
  message: string;
  result?: unknown;
}

/**
 * Dispatches an APPROVED pending action to the underlying module. On success,
 * marks the row 'executed' and returns the human-readable outcome message
 * for posting back to Telegram. On failure, marks 'failed' and surfaces the
 * error — TokenInvalidError still propagates so the caller can halt the
 * whole approval loop if the token died.
 */
export async function executePending(p: PendingAction): Promise<ExecuteOutcome> {
  try {
    const result = await dispatch(p);
    await markExecuted(p.id, result.result ?? null);
    return result;
  } catch (err) {
    if (err instanceof TokenInvalidError) {
      await markFailed(p.id, `TokenInvalid: ${err.reason}`);
      throw err;
    }
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, pendingId: p.id, kind: p.actionKind }, 'Pending execute failed');
    await markFailed(p.id, msg);
    return { ok: false, message: `❌ Gagal: ${msg}` };
  }
}

async function dispatch(p: PendingAction): Promise<ExecuteOutcome> {
  const kind = p.actionKind as ActionKind;
  const connectionId = p.connectionId;
  switch (kind) {
    case 'pause':
    case 'auto_pause': {
      const payload = p.payload as PausePayload;
      const r = await pause({
        connectionId,
        target: { type: 'campaign', id: payload.campaignId },
        actorId: p.requestedBy ?? 'telegram',
      });
      return {
        ok: r.outcome === 'success' || r.outcome === 'noop',
        message: `⏸ ${r.outcome.toUpperCase()} — ${r.message}`,
        result: { outcome: r.outcome, previousStatus: r.previousStatus },
      };
    }
    case 'resume': {
      const payload = p.payload as ResumePayload;
      const r = await unpause({
        connectionId,
        target: { type: 'campaign', id: payload.campaignId },
        actorId: p.requestedBy ?? 'telegram',
      });
      if (r.outcome === 'blocked' && r.blockers) {
        return {
          ok: false,
          message: `🚫 Tidak bisa resume — ${r.blockers.length} blocker(s):\n` +
            r.blockers.map((b) => `  • ${b.message}`).join('\n'),
        };
      }
      return {
        ok: r.outcome === 'success' || r.outcome === 'noop',
        message: `▶️ ${r.message}`,
        result: { outcome: r.outcome },
      };
    }
    case 'budget': {
      const payload = p.payload as BudgetPayload;
      // commands.ts already resolved campaign vs adset ownership; pass through.
      const owner = await detectBudgetOwner(connectionId, {
        type: payload.targetType,
        id: payload.targetId,
      });
      const currentMinor = owner.dailyBudgetMinor ?? owner.lifetimeBudgetMinor ?? 0;
      const newMinor = payload.newAmountMinor;
      const fn = newMinor > currentMinor ? increaseBudget : decreaseBudget;
      const r = await fn({
        connectionId,
        target: { type: payload.targetType, id: payload.targetId },
        newAmountMinor: newMinor,
        reason: `Approved via Telegram (budget)`,
        actorId: p.requestedBy ?? 'telegram',
      });
      return {
        ok: true,
        message:
          `💰 Budget ${r.kind} (${owner.level}) — ${r.previousMinor / 100} → ${r.newMinor / 100} ` +
          `(${r.appliedPct >= 0 ? '+' : ''}${r.appliedPct}%)`,
        result: { previousMinor: r.previousMinor, newMinor: r.newMinor, level: owner.level },
      };
    }
    case 'auto_scale': {
      const payload = p.payload as AutoScalePayload;
      const owner = await detectBudgetOwner(connectionId, {
        type: 'campaign',
        id: payload.campaignId,
      });
      const currentMinor = owner.dailyBudgetMinor ?? owner.lifetimeBudgetMinor ?? 0;
      const newMinor = Math.floor(currentMinor * (1 + payload.pct / 100));
      const fn = newMinor > currentMinor ? increaseBudget : decreaseBudget;
      const r = await fn({
        connectionId,
        target: { type: owner.ownerType, id: owner.ownerId },
        newAmountMinor: newMinor,
        reason: `Approved via Telegram (auto_scale)`,
        actorId: p.requestedBy ?? 'telegram',
      });
      return {
        ok: true,
        message:
          `💰 Budget ${r.kind} — ${r.previousMinor / 100} → ${r.newMinor / 100} ` +
          `(${r.appliedPct >= 0 ? '+' : ''}${r.appliedPct}%)`,
        result: { previousMinor: r.previousMinor, newMinor: r.newMinor },
      };
    }
    case 'audience_engagement': {
      const payload = p.payload as AudienceEngagementPayload;
      const a = await createMultiSourceEngagementAudience({
        connectionId,
        retentionDays: payload.retentionDays,
        name: payload.name,
        actorId: p.requestedBy ?? 'telegram',
      });
      return {
        ok: true,
        message: `✅ Audience created — ${a.name} (id ${a.id})`,
        result: { audienceId: a.id, name: a.name },
      };
    }
    case 'audience_lookalike': {
      const payload = p.payload as AudienceLookalikePayload;
      const audiences = await createLookalike({
        connectionId,
        name: payload.name,
        originAudienceId: payload.sourceAudienceId,
        country: 'ID',
        ratios: [payload.ratioPct / 100],
        actorId: p.requestedBy ?? 'telegram',
      });
      const a = audiences[0];
      if (!a) throw new Error('Lookalike API returned no audience');
      return {
        ok: true,
        message: `✅ Lookalike created — ${a.name} (id ${a.id})`,
        result: { audienceId: a.id, name: a.name },
      };
    }
    case 'copy_approve': {
      const payload = p.payload as CopyApprovePayload;
      const r = await approveOption(
        payload.campaignId,
        payload.optionIndex,
        p.requestedBy ?? 'telegram',
      );
      if (!r.approved) {
        return {
          ok: false,
          message: `Tidak ada draft opsi ${payload.optionIndex} untuk campaign ${payload.campaignId}.`,
        };
      }
      return {
        ok: true,
        message:
          `✅ Opsi ${payload.optionIndex} di-approve sebagai draft.\n` +
          `Variant id: ${r.approved.id}\n` +
          `Primary: ${r.approved.primaryText.slice(0, 200)}`,
        result: { variantId: r.approved.id, rejectedIds: r.rejected.map((x) => x.id) },
      };
    }
    case 'publish_ad': {
      const payload = p.payload as PublishAdPayload;
      const r = await executePublishAd(connectionId, payload);
      return {
        ok: r.ok,
        message: r.message,
        result: r.result,
      };
    }
    default: {
      const exhaust: never = kind;
      return { ok: false, message: `Unknown action kind: ${String(exhaust)}` };
    }
  }
}
