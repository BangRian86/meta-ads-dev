import { and, eq } from 'drizzle-orm';
import { db, logger, notifyOwner } from '../00-foundation/index.js';
import { metaConnections } from '../../db/schema/meta-connections.js';
import {
  metaObjectSnapshots,
  type MetaObjectSnapshot,
} from '../../db/schema/meta-object-snapshots.js';
import {
  analyze,
  type DateRange,
  type Target,
} from '../02-ads-analysis/index.js';
import { isOnCooldown, markSent } from './dedupe.js';

export type AnomalyKind =
  | 'spend_drop'
  | 'spend_spike'
  | 'no_impressions'
  | 'cpr_spike';

export interface AnomalyAlert {
  kind: AnomalyKind;
  /** Stable identifier used for dedupe — same key won't fire twice in 6h. */
  key: string;
  message: string;
}

const SPEND_DROP_PCT = 0.5; // today < 50% of baseline
const SPEND_SPIKE_PCT = 2.0; // today > 200% of baseline
const NO_IMPRESSIONS_HOURS = 2;
const CPR_SPIKE_PCT = 2.0; // today > 200% of yesterday

/**
 * Runs anomaly detection for one connection and pushes any new alerts to the
 * group chat (via notifyOwner — group-only after the recent rewire).
 * Deduplicates within 6h via the alert_dedupe table. Safe to call from the
 * optimizer runner — failures here are caught and logged so they never abort
 * the optimizer pass.
 */
export async function detectAndNotifyAnomalies(
  connectionId: string,
): Promise<AnomalyAlert[]> {
  try {
    const alerts = await detect(connectionId);
    const fired: AnomalyAlert[] = [];
    for (const a of alerts) {
      if (await isOnCooldown(a.key)) {
        logger.debug({ key: a.key, kind: a.kind }, 'Anomaly muted by cooldown');
        continue;
      }
      const r = await notifyOwner(a.message);
      if (r.delivered) {
        await markSent(a.key);
        fired.push(a);
      } else {
        logger.warn(
          { key: a.key, reason: r.reason },
          'Anomaly send failed — not marking as sent so it can retry next run',
        );
      }
    }
    return fired;
  } catch (err) {
    logger.error({ err, connectionId }, 'Anomaly detection crashed');
    return [];
  }
}

async function detect(connectionId: string): Promise<AnomalyAlert[]> {
  const [conn] = await db
    .select()
    .from(metaConnections)
    .where(eq(metaConnections.id, connectionId))
    .limit(1);
  if (!conn) return [];

  const activeCampaigns = await loadActiveCampaigns(connectionId);
  if (activeCampaigns.length === 0) return [];

  const today = isoDateOffset(0);
  const yesterday = isoDateOffset(-1);
  const baselineSince = isoDateOffset(-3);
  const baselineUntil = isoDateOffset(-1);

  const targets: Target[] = activeCampaigns.map((c) => ({
    type: 'campaign',
    id: c.objectId,
  }));

  // Three windows: today (1d), yesterday (1d), prior-3d baseline.
  const [todayResult, yesterdayResult, baselineResult] = await Promise.all([
    analyze({
      connectionId,
      targets,
      range: { since: today, until: today },
    }),
    analyze({
      connectionId,
      targets,
      range: { since: yesterday, until: yesterday },
    }),
    analyze({
      connectionId,
      targets,
      range: { since: baselineSince, until: baselineUntil },
    }),
  ]);

  const alerts: AnomalyAlert[] = [];

  // Account-level spend anomalies. Use 3-day average as baseline so a single
  // off-day doesn't trigger. Skip when baseline is too small to compare
  // meaningfully (Rp 100k floor).
  const todayAccountSpend = todayResult.rollup.spend;
  const baselineAvgSpend = baselineResult.rollup.spend / 3;
  if (baselineAvgSpend >= 100_000) {
    if (todayAccountSpend < baselineAvgSpend * SPEND_DROP_PCT) {
      const pct = Math.round(
        ((todayAccountSpend - baselineAvgSpend) / baselineAvgSpend) * 100,
      );
      alerts.push({
        kind: 'spend_drop',
        key: `spend_drop:${connectionId}:${today}`,
        message:
          `⚠️ ALERT: Spend ${conn.accountName} turun drastis!\n` +
          `Baseline 3 hari: ${fmtIdr(baselineAvgSpend)}/hari | Hari ini: ${fmtIdr(todayAccountSpend)} (${pct}%)\n` +
          `Kemungkinan: campaign habis budget, iklan dimatikan, atau masalah pembayaran`,
      });
    } else if (todayAccountSpend > baselineAvgSpend * SPEND_SPIKE_PCT) {
      const pct = Math.round(
        ((todayAccountSpend - baselineAvgSpend) / baselineAvgSpend) * 100,
      );
      alerts.push({
        kind: 'spend_spike',
        key: `spend_spike:${connectionId}:${today}`,
        message:
          `⚠️ ALERT: Spend ${conn.accountName} naik drastis!\n` +
          `Baseline 3 hari: ${fmtIdr(baselineAvgSpend)}/hari | Hari ini: ${fmtIdr(todayAccountSpend)} (+${pct}%)\n` +
          `Cek apakah ada perubahan budget yang tidak disengaja`,
      });
    }
  }

  // Per-campaign anomalies: no-impressions and CPR spike.
  for (const t of todayResult.perTarget) {
    const snap = activeCampaigns.find((c) => c.objectId === t.target.id);
    if (!snap) continue;

    // No impressions check — only meaningful when the campaign has been
    // ACTIVE long enough for traffic to accrue. We use the snapshot's
    // fetched_at as a proxy for "we know it's been active at least since".
    // A 2h grace from the start of UTC day or from snapshot fetched_at,
    // whichever is later, avoids false positives on fresh activations.
    if (t.summary.impressions === 0) {
      const hoursActive = hoursSinceStartOfUtcDay();
      if (hoursActive >= NO_IMPRESSIONS_HOURS) {
        alerts.push({
          kind: 'no_impressions',
          key: `no_impressions:${connectionId}:${snap.objectId}:${today}`,
          message:
            `⚠️ ALERT: ${snap.name} aktif tapi tidak tayang!\n` +
            `Akun: ${conn.accountName} | Sudah ${Math.floor(hoursActive)} jam tidak ada impresi\n` +
            `Kemungkinan: masalah kreatif, audience terlalu sempit, atau akun bermasalah`,
        });
      }
    }

    // CPR spike vs yesterday. Skip when either window has 0 results — the
    // earlier handlers already cover "no spend / no results" via spend
    // anomalies and stoppage detection.
    const yt = yesterdayResult.perTarget.find(
      (x) => x.target.id === t.target.id,
    );
    if (yt && yt.summary.cpr > 0 && t.summary.cpr > 0) {
      if (t.summary.cpr > yt.summary.cpr * CPR_SPIKE_PCT) {
        const pct = Math.round(
          ((t.summary.cpr - yt.summary.cpr) / yt.summary.cpr) * 100,
        );
        alerts.push({
          kind: 'cpr_spike',
          key: `cpr_spike:${connectionId}:${snap.objectId}:${today}`,
          message:
            `⚠️ ALERT: CPR ${snap.name} naik drastis!\n` +
            `Akun: ${conn.accountName}\n` +
            `Kemarin: ${fmtIdr(yt.summary.cpr)} | Hari ini: ${fmtIdr(t.summary.cpr)} (+${pct}%)\n` +
            `Pertimbangkan pause atau refresh creative`,
        });
      }
    }
  }

  return alerts;
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

function isoDateOffset(daysFromToday: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromToday);
  return d.toISOString().slice(0, 10);
}

function hoursSinceStartOfUtcDay(): number {
  const now = new Date();
  const startOfDay = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  return (now.getTime() - startOfDay.getTime()) / (60 * 60 * 1000);
}

function fmtIdr(n: number): string {
  return `Rp ${Math.round(n).toLocaleString('id-ID')}`;
}
