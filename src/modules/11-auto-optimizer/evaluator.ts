import { and, eq } from 'drizzle-orm';
import { db, logger } from '../00-foundation/index.js';
import {
  metaObjectSnapshots,
  type MetaObjectSnapshot,
} from '../../db/schema/meta-object-snapshots.js';
import { appConfig as config } from '../00-foundation/index.js';
import { analyze, type DateRange, type Target } from '../02-ads-analysis/index.js';
import type { DecisionKind, OptimizerDecision } from './schema.js';

export interface CampaignWithSummary {
  snapshot: MetaObjectSnapshot;
  spendIdr: number;
  results: number;
  cprIdr: number;
  ctrPct: number;
  createdTime: Date | null;
  ageDays: number | null;
  effectiveStatus: string;
}

/**
 * Evaluates every active campaign on the connection and returns the
 * recommended decisions. Pure read-only — no Meta writes happen here.
 */
export async function evaluate(
  connectionId: string,
): Promise<{ campaigns: CampaignWithSummary[]; decisions: OptimizerDecision[] }> {
  const activeCampaigns = await loadActiveCampaigns(connectionId);
  const pausedRecent = await loadRecentlyPausedCampaigns(connectionId);

  // Filter campaign ACTIVE yang sebenernya nggak nayang — yaitu yang
  // SEMUA adset child-nya sudah PAUSED/DELETED/ARCHIVED. Tanpa filter ini
  // optimizer akan trigger CPR alert dan copy_fix_suggestion untuk
  // campaign "ghost active": status di Meta ACTIVE tapi nol delivery,
  // sehingga CPR pasti naik tinggi (denominator results=0 atau spend dari
  // sisa learning lama). False alarm yang spam owner.
  //
  // Aturan: campaign lolos kalau MINIMAL satu adset child-nya ACTIVE.
  // Kalau snapshot adset belum ada (mis. sync belum jalan), juga di-skip
  // — defensive: lebih baik miss legit campaign satu cycle daripada
  // generate alert palsu.
  const adsetsByCampaign = await loadLatestAdsetsByCampaign(connectionId);
  const eligibleCampaigns: MetaObjectSnapshot[] = [];
  for (const camp of activeCampaigns) {
    const adsets = adsetsByCampaign.get(camp.objectId) ?? [];
    const hasActiveAdset = adsets.some((a) => a.status === 'ACTIVE');
    if (!hasActiveAdset) {
      logger.info(
        {
          campaignId: camp.objectId,
          campaignName: camp.name,
          adsetCount: adsets.length,
          adsetStatuses: adsets.map((a) => a.status),
        },
        `Skip campaign ${camp.name}: semua adset paused`,
      );
      continue;
    }
    eligibleCampaigns.push(camp);
  }

  const decisions: OptimizerDecision[] = [];
  const enriched: CampaignWithSummary[] = [];

  if (eligibleCampaigns.length > 0) {
    const range: DateRange = {
      since: isoDateOffset(-(config.optimizer.auditWindowDays - 1)),
      until: isoDateOffset(0),
    };
    const targets: Target[] = eligibleCampaigns.map((c) => ({
      type: 'campaign',
      id: c.objectId,
    }));
    const result = await analyze({ connectionId, targets, range });

    for (const t of result.perTarget) {
      const snap = eligibleCampaigns.find((c) => c.objectId === t.target.id);
      if (!snap) continue;
      const createdTime = parseCreatedTime(snap);
      const ageDays =
        createdTime !== null
          ? Math.floor((Date.now() - createdTime.getTime()) / (24 * 60 * 60 * 1000))
          : null;
      const summary: CampaignWithSummary = {
        snapshot: snap,
        spendIdr: t.summary.spend,
        results: t.summary.results,
        cprIdr: t.summary.cpr,
        ctrPct: t.summary.ctr,
        createdTime,
        ageDays,
        effectiveStatus: snap.effectiveStatus,
      };
      enriched.push(summary);
      decisions.push(...classifyActive(summary));
    }
  }

  for (const snap of pausedRecent) {
    decisions.push(...classifyPaused(snap));
  }

  return { campaigns: enriched, decisions };
}

function classifyActive(c: CampaignWithSummary): OptimizerDecision[] {
  const out: OptimizerDecision[] = [];
  const opt = config.optimizer;
  const meta = {
    cprIdr: c.cprIdr,
    spendIdr: c.spendIdr,
    results: c.results,
    ageDays: c.ageDays ?? -1,
    ctrPct: c.ctrPct,
  };

  // 1) CPR alert — anytime CPR exceeds the auto-pause threshold, regardless of age.
  //    Helps the owner see issues early before the 2-day mark triggers auto-pause.
  if (c.cprIdr > opt.autoPauseCprIdr && c.results > 0) {
    out.push({
      kind: 'cpr_alert',
      campaignId: c.snapshot.objectId,
      campaignName: c.snapshot.name,
      reason: `CPR Rp ${Math.round(c.cprIdr).toLocaleString('id-ID')} exceeds Rp ${opt.autoPauseCprIdr.toLocaleString('id-ID')} threshold`,
      metrics: meta,
    });
  }

  // 2) Copy-fix suggestion: CPR > threshold AND age >= 2 days. Replaces the
  //    old auto_pause behavior — instead of force-pausing, we ask AI to draft
  //    3 alternative copy variants and let the operator approve one via
  //    Telegram. Operator can still /pause manually if they prefer.
  if (
    c.cprIdr > opt.autoPauseCprIdr &&
    c.ageDays !== null &&
    c.ageDays >= opt.autoPauseMinDays &&
    c.results > 0
  ) {
    out.push(
      makeDecision(
        'copy_fix_suggestion',
        c,
        `Sustained high CPR after ${c.ageDays}d — generate alt copy for owner approval`,
        meta,
      ),
    );
  }

  // 3) Auto-scale: low CPR AND past learning phase AND has a budget to scale.
  const inLearning =
    c.effectiveStatus === 'LEARNING' || c.effectiveStatus === 'LEARNING_LIMITED';
  if (
    c.cprIdr > 0 &&
    c.cprIdr < opt.autoScaleCprIdr &&
    c.results > 0 &&
    !inLearning
  ) {
    out.push(makeDecision('auto_scale', c, `CPR Rp ${Math.round(c.cprIdr).toLocaleString('id-ID')} below scale threshold; past learning`, meta));
  }

  return out;
}

function classifyPaused(snap: MetaObjectSnapshot): OptimizerDecision[] {
  return [
    {
      kind: 'resume_notify',
      campaignId: snap.objectId,
      campaignName: snap.name,
      reason: `Paused since ${snap.fetchedAt.toISOString().slice(0, 10)} — please review for resume`,
      metrics: {},
    },
  ];
}

function makeDecision(
  kind: DecisionKind,
  c: CampaignWithSummary,
  reason: string,
  metrics: Record<string, number>,
): OptimizerDecision {
  return {
    kind,
    campaignId: c.snapshot.objectId,
    campaignName: c.snapshot.name,
    reason,
    metrics,
  };
}

async function loadActiveCampaigns(
  connectionId: string,
): Promise<MetaObjectSnapshot[]> {
  const rows = await db
    .select()
    .from(metaObjectSnapshots)
    .where(
      and(
        eq(metaObjectSnapshots.connectionId, connectionId),
        eq(metaObjectSnapshots.objectType, 'campaign'),
      ),
    );
  const latest = new Map<string, MetaObjectSnapshot>();
  for (const r of rows) {
    const cur = latest.get(r.objectId);
    if (!cur || r.fetchedAt.getTime() > cur.fetchedAt.getTime()) {
      latest.set(r.objectId, r);
    }
  }
  return [...latest.values()].filter((r) => r.status === 'ACTIVE');
}

/**
 * Map campaign_id → latest adset snapshots (one per distinct adset id).
 * Dipakai untuk filter "ghost active" campaign — campaign ACTIVE yang
 * semua adset child-nya sudah pause. Kembalikan latest-per-adset (dedupe
 * by objectId, ambil fetched_at terbaru) supaya status mencerminkan
 * snapshot terkini, bukan campur historis.
 */
async function loadLatestAdsetsByCampaign(
  connectionId: string,
): Promise<Map<string, MetaObjectSnapshot[]>> {
  const rows = await db
    .select()
    .from(metaObjectSnapshots)
    .where(
      and(
        eq(metaObjectSnapshots.connectionId, connectionId),
        eq(metaObjectSnapshots.objectType, 'adset'),
      ),
    );
  const latestById = new Map<string, MetaObjectSnapshot>();
  for (const r of rows) {
    const cur = latestById.get(r.objectId);
    if (!cur || r.fetchedAt.getTime() > cur.fetchedAt.getTime()) {
      latestById.set(r.objectId, r);
    }
  }
  const out = new Map<string, MetaObjectSnapshot[]>();
  for (const a of latestById.values()) {
    if (!a.campaignId) continue;
    const list = out.get(a.campaignId);
    if (list) list.push(a);
    else out.set(a.campaignId, [a]);
  }
  return out;
}

async function loadRecentlyPausedCampaigns(
  connectionId: string,
): Promise<MetaObjectSnapshot[]> {
  const rows = await db
    .select()
    .from(metaObjectSnapshots)
    .where(
      and(
        eq(metaObjectSnapshots.connectionId, connectionId),
        eq(metaObjectSnapshots.objectType, 'campaign'),
      ),
    );
  const latest = new Map<string, MetaObjectSnapshot>();
  for (const r of rows) {
    const cur = latest.get(r.objectId);
    if (!cur || r.fetchedAt.getTime() > cur.fetchedAt.getTime()) {
      latest.set(r.objectId, r);
    }
  }
  const cutoff =
    Date.now() - config.optimizer.resumeNotifyDays * 24 * 60 * 60 * 1000;
  return [...latest.values()].filter(
    (r) => r.status === 'PAUSED' && r.fetchedAt.getTime() <= cutoff,
  );
}

function parseCreatedTime(snap: MetaObjectSnapshot): Date | null {
  const raw = snap.rawPayload as { created_time?: unknown } | null;
  if (!raw || typeof raw !== 'object') return null;
  const ct = raw.created_time;
  if (typeof ct !== 'string') return null;
  const d = new Date(ct);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isoDateOffset(daysFromToday: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromToday);
  return d.toISOString().slice(0, 10);
}
