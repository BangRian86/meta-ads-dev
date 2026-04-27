import { and, desc, eq } from 'drizzle-orm';
import { db } from '../00-foundation/index.js';
import {
  metaConnections,
  type MetaConnection,
} from '../../db/schema/meta-connections.js';
import {
  metaObjectSnapshots,
  type MetaObjectSnapshot,
} from '../../db/schema/meta-object-snapshots.js';
import { analyze, type Target } from '../02-ads-analysis/index.js';
import { classifyCampaign, type Bucket } from './channel.js';
import { detectBrand, lookupBenchmark, statusEmoji, type Brand } from './benchmarks.js';

export interface CampaignProgressRow {
  campaignId: string;
  name: string;
  bucket: Bucket;
  spend: number;
  results: number;
  clicks: number;
  impressions: number;
  cpr: number;
  cpc: number;
  cpm: number;
  emoji: '✅' | '⚠️' | '';
}

export interface AccountProgress {
  connection: MetaConnection;
  brand: Brand;
  rows: CampaignProgressRow[];
  subtotalSpend: number;
  subtotalResults: number;
}

export interface ProgressReport {
  /** YYYY-MM-DD (UTC) of the data window. */
  date: string;
  accounts: AccountProgress[];
  totalSpend: number;
  totalResults: number;
  errors: Array<{ accountName: string; message: string }>;
}

async function listActiveConnections(): Promise<MetaConnection[]> {
  return db
    .select()
    .from(metaConnections)
    .where(eq(metaConnections.status, 'active'));
}

/** Latest snapshot per campaign id for one connection, filtered to ACTIVE
 *  AND DELIVERING (effective_status = ACTIVE). */
async function deliveringCampaignSnapshots(
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
    )
    .orderBy(desc(metaObjectSnapshots.fetchedAt));
  const seen = new Set<string>();
  const latest: MetaObjectSnapshot[] = [];
  for (const r of rows) {
    if (seen.has(r.objectId)) continue;
    seen.add(r.objectId);
    latest.push(r);
  }
  return latest.filter(
    (r) => r.status === 'ACTIVE' && r.effectiveStatus === 'ACTIVE',
  );
}

/** Latest adset snapshot per campaign — used to read destination_type from
 *  the freshest adset under each campaign. */
async function latestAdsetByCampaign(
  connectionId: string,
): Promise<Map<string, MetaObjectSnapshot>> {
  const rows = await db
    .select()
    .from(metaObjectSnapshots)
    .where(
      and(
        eq(metaObjectSnapshots.connectionId, connectionId),
        eq(metaObjectSnapshots.objectType, 'adset'),
      ),
    )
    .orderBy(desc(metaObjectSnapshots.fetchedAt));
  const out = new Map<string, MetaObjectSnapshot>();
  for (const r of rows) {
    if (!r.campaignId) continue;
    if (out.has(r.campaignId)) continue;
    out.set(r.campaignId, r);
  }
  return out;
}

function readPayloadString(payload: unknown, key: string): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const v = (payload as Record<string, unknown>)[key];
  return typeof v === 'string' ? v : null;
}

function isoTodayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Builds today's progress data for every active connection. Failures on a
 * single connection are captured into `errors` so one broken token does not
 * blank the rest of the report.
 */
export async function buildProgressData(): Promise<ProgressReport> {
  const date = isoTodayUtc();
  const conns = await listActiveConnections();
  const accounts: AccountProgress[] = [];
  const errors: ProgressReport['errors'] = [];
  let totalSpend = 0;
  let totalResults = 0;

  for (const conn of conns) {
    try {
      const brand = detectBrand(conn.accountName);
      const campaigns = await deliveringCampaignSnapshots(conn.id);
      const adsetByCampaign = await latestAdsetByCampaign(conn.id);

      let rows: CampaignProgressRow[] = [];
      let subtotalSpend = 0;
      let subtotalResults = 0;

      if (campaigns.length > 0) {
        const targets: Target[] = campaigns.map((c) => ({
          type: 'campaign',
          id: c.objectId,
        }));
        const result = await analyze({
          connectionId: conn.id,
          targets,
          range: { since: date, until: date },
        });
        const summaryById = new Map(
          result.perTarget.map((t) => [t.target.id, t.summary]),
        );

        for (const c of campaigns) {
          const objective = readPayloadString(c.rawPayload, 'objective');
          const adset = adsetByCampaign.get(c.objectId);
          const destinationType = adset
            ? readPayloadString(adset.rawPayload, 'destination_type')
            : null;
          const info = classifyCampaign(objective, destinationType, c.name);
          if (!info) continue; // Skip uncategorisable campaigns silently.
          const summary = summaryById.get(c.objectId);
          if (!summary) continue;
          subtotalSpend += summary.spend;
          subtotalResults += summary.results;

          let benchValue = 0;
          let benchmark = lookupBenchmark(brand, info.channel);
          if (info.bucket === 'leads') benchValue = summary.cpr;
          else if (info.bucket === 'traffic') benchValue = summary.cpc;
          else if (info.bucket === 'awareness') benchValue = summary.cpm;

          rows.push({
            campaignId: c.objectId,
            name: c.name,
            bucket: info.bucket,
            spend: summary.spend,
            results: summary.results,
            clicks: summary.clicks,
            impressions: summary.impressions,
            cpr: summary.cpr,
            cpc: summary.cpc,
            cpm: summary.cpm,
            emoji: statusEmoji(benchValue, benchmark),
          });
        }

        // Drop rows that are technically delivering but had no impressions
        // and no spend today — they pad the report without adding signal.
        // Subtotals are recomputed from the filtered rows so they match.
        rows = rows
          .filter((r) => r.spend > 0 || r.impressions > 0)
          .sort((a, b) => b.spend - a.spend);
        subtotalSpend = rows.reduce((s, r) => s + r.spend, 0);
        subtotalResults = rows.reduce((s, r) => s + r.results, 0);
      }

      accounts.push({
        connection: conn,
        brand,
        rows,
        subtotalSpend,
        subtotalResults,
      });
      totalSpend += subtotalSpend;
      totalResults += subtotalResults;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ accountName: conn.accountName, message });
      // Still push a placeholder so the account header shows up.
      accounts.push({
        connection: conn,
        brand: detectBrand(conn.accountName),
        rows: [],
        subtotalSpend: 0,
        subtotalResults: 0,
      });
    }
  }

  return { date, accounts, totalSpend, totalResults, errors };
}
