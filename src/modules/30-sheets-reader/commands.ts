/**
 * Handler logic untuk 5 command Sheets-reader. Setiap fungsi return
 * `string` (text untuk dikirim ke Telegram). Wiring ke Telegraf di
 * 10-telegram-bot/commands.ts.
 */
import { logger } from '../00-foundation/index.js';
import { parseDateRange } from '../10-telegram-bot/date-args.js';
import {
  BUSINESSES,
  parseBusiness,
  parseBranch,
  resolveBranch,
  type Business,
  type ResolvedBranch,
} from './business-resolver.js';
import { wibIsoDate, isNoData } from './cell-utils.js';
import {
  aggregateCsForRange,
  clearCsCache,
  findCsByName,
  loadAllCsPerform,
  rankAllCsForRange,
  type CsMatch,
} from './cs-data.js';
import {
  aggregateReporting,
  aggregateTiktok,
  pickRowForDate,
  readReportingForBranch,
} from './reporting-data.js';
import {
  findActiveConfig,
  loadAllAlertConfigs,
  type AlertMetric,
} from './alert-config.js';
import {
  classifySeverity,
  formatAlertReport,
  formatCabangAggregate,
  formatCabangSingle,
  formatCsAggregate,
  formatCsRanking,
  formatCsSingle,
  formatRoasRange,
  formatRoasSingle,
  formatTiktokRange,
  formatTiktokSingle,
  type AlertFinding,
} from './formatter.js';

const BUSINESS_LABEL: Record<Business, string> = {
  basmalah: 'Basmalah Travel',
  aqiqah: 'Aqiqah Express',
};

// ─────────────────── shared helpers ───────────────────

interface ParsedRange {
  since: string;
  until: string;
  isSingleDay: boolean;
}

/**
 * Parse [periode] arg. Default = WIB-today (single day) per spec.
 * Reuse parseDateRange yang sudah ada — output sama (YYYY-MM-DD), tapi
 * default-nya kita override ke WIB-today.
 */
function parsePeriodArg(arg?: string): ParsedRange | { error: string } {
  if (!arg || !arg.trim()) {
    const today = wibIsoDate();
    return { since: today, until: today, isSingleDay: true };
  }
  const parsed = parseDateRange([arg]);
  if (!parsed.ok) return { error: parsed.reason };
  return {
    since: parsed.range.since,
    until: parsed.range.until,
    isSingleDay: parsed.range.since === parsed.range.until,
  };
}

/** Parse two-arg "since until" (mis. "1apr 15apr"). */
function parsePeriodArgs(args: string[]): ParsedRange | { error: string } {
  if (args.length === 0) {
    const today = wibIsoDate();
    return { since: today, until: today, isSingleDay: true };
  }
  const parsed = parseDateRange(args);
  if (!parsed.ok) return { error: parsed.reason };
  return {
    since: parsed.range.since,
    until: parsed.range.until,
    isSingleDay: parsed.range.since === parsed.range.until,
  };
}

// ─────────────────── /cs ───────────────────

export async function handleCsCommand(args: string[]): Promise<string> {
  // /cs                         → list ranking semua CS today
  // /cs nama                    → CS detail today
  // /cs nama 7d                 → CS detail 7d
  // /cs nama 1apr 15apr         → CS detail range
  if (args.length === 0) {
    const today = wibIsoDate();
    const rows = await rankAllCsForRange(today, today);
    return formatCsRanking(rows, today, today);
  }

  const name = args[0]!;
  const periodArgs = args.slice(1);
  const range = parsePeriodArgs(periodArgs);
  if ('error' in range) return `❌ ${range.error}`;

  const matches = await findCsByName(name);
  if (matches.length === 0) {
    return (
      `🤷 CS dengan nama "${name}" nggak ketemu di Sheet.\n` +
      `Coba /cs (tanpa argumen) buat lihat daftar CS yang ada.`
    );
  }
  if (matches.length > 1) {
    return formatCsAmbiguous(name, matches);
  }
  const m = matches[0]!;
  const all = await loadAllCsPerform();
  if (range.isSingleDay) {
    // Single day: cari row exact di tanggal itu.
    const row = all.find(
      (r) =>
        r.business === m.business &&
        r.csName === m.csName &&
        r.isoDate === range.since,
    );
    if (!row) {
      return (
        `ℹ️ ${m.csName} (${m.contextLabel}) — ${range.since}\n\n` +
        `Belum ada data di tanggal ini. Coba range lebih panjang: ` +
        `/cs ${name} 7d`
      );
    }
    return formatCsSingle(row);
  }
  const agg = aggregateCsForRange(all, m.csName, m.business, range.since, range.until);
  if (!agg) {
    return (
      `ℹ️ ${m.csName} (${m.contextLabel}) — ${range.since} → ${range.until}\n\n` +
      `Belum ada data di periode ini.`
    );
  }
  return formatCsAggregate(agg);
}

function formatCsAmbiguous(query: string, matches: CsMatch[]): string {
  const lines: string[] = [];
  lines.push(`🤔 "${query}" cocok ke ${matches.length} CS:`);
  for (const m of matches) {
    lines.push(`• ${m.csName} (${m.contextLabel}${m.branch ? ' — ' + m.branch : ''})`);
  }
  lines.push('');
  lines.push('Spesifikkan namanya lebih lengkap, contoh:');
  for (const m of matches.slice(0, 2)) {
    lines.push(`  /cs ${m.csName.toLowerCase()}`);
  }
  return lines.join('\n');
}

// ─────────────────── /cabang ───────────────────

export async function handleCabangCommand(args: string[]): Promise<string> {
  // /cabang                          → list ranking semua cabang today
  // /cabang pusat                    → today
  // /cabang aqiqah pusat 7d          → explicit business + range
  // /cabang basmalah pusat
  if (args.length === 0) {
    return await rankAllCabang(wibIsoDate(), wibIsoDate());
  }

  // Detect "business cabang [period]" vs "cabang [period]"
  let business: Business | null = null;
  let branchInput: string | null = null;
  let periodArgs: string[] = [];

  const first = args[0]!;
  const maybeBiz = parseBusiness(first);
  if (maybeBiz) {
    business = maybeBiz;
    branchInput = args[1] ?? null;
    periodArgs = args.slice(2);
  } else {
    branchInput = first;
    periodArgs = args.slice(1);
  }

  if (!branchInput) {
    return `❌ Cabang belum disebut. Contoh: /cabang pusat atau /cabang aqiqah jabar 7d`;
  }
  if (!parseBranch(branchInput)) {
    return (
      `❌ Cabang "${branchInput}" nggak dikenal.\n` +
      `Yang valid: PUSAT, JABAR, JATIM, JOGJA`
    );
  }

  const resolveResult = resolveBranch(branchInput, business ?? undefined);
  if (!resolveResult.ok) {
    if (resolveResult.reason === 'ambiguous') {
      const lines: string[] = [];
      lines.push(`🤔 Cabang "${branchInput.toUpperCase()}" ada di ${resolveResult.matches.length} bisnis:`);
      for (const m of resolveResult.matches) {
        lines.push(`• ${m.business.label} - ${m.branch}`);
      }
      lines.push('');
      lines.push('Spesifikkan bisnisnya:');
      for (const m of resolveResult.matches) {
        lines.push(`  /cabang ${m.business.business} ${m.branch.toLowerCase()}`);
      }
      return lines.join('\n');
    }
    return `❌ Cabang "${branchInput}" nggak ditemukan${business ? ' di ' + BUSINESS_LABEL[business] : ''}.`;
  }

  const range = parsePeriodArgs(periodArgs);
  if ('error' in range) return `❌ ${range.error}`;

  const rows = await readReportingForBranch(resolveResult.resolved);
  if (range.isSingleDay) {
    const row = pickRowForDate(rows, range.since);
    if (!row) {
      return (
        `ℹ️ ${resolveResult.resolved.business.label} ${resolveResult.resolved.branch}\n` +
        `📅 ${range.since}\n\n` +
        `Belum ada baris untuk tanggal ini di tab ${resolveResult.resolved.reportingTab}.`
      );
    }
    return formatCabangSingle(
      row,
      resolveResult.resolved.business.label,
      resolveResult.resolved.branch,
    );
  }
  const agg = aggregateReporting(rows, range.since, range.until);
  return formatCabangAggregate(
    agg,
    resolveResult.resolved.business.label,
    resolveResult.resolved.branch,
  );
}

async function rankAllCabang(since: string, until: string): Promise<string> {
  const lines: string[] = [];
  lines.push(`🏢 Semua cabang — ${since === until ? since : `${since} → ${until}`}`);
  lines.push('');
  // Iterate semua cabang, baca single day or aggregate.
  interface Row {
    label: string;
    revenue: number;
    roas: number | null;
  }
  const rows: Row[] = [];
  for (const biz of BUSINESSES) {
    for (const b of biz.branches) {
      try {
        const reporting = await readReportingForBranch({
          business: biz,
          branch: b.branch,
          reportingTab: b.reportingTab,
        });
        const agg = aggregateReporting(reporting, since, until);
        rows.push({
          label: `${biz.label} - ${b.branch}`,
          revenue: isNoData(agg.totalRevenue.value) ? 0 : agg.totalRevenue.value,
          roas: isNoData(agg.avgRoas.value) ? null : agg.avgRoas.value,
        });
      } catch (err) {
        logger.warn(
          { err, branch: b.branch },
          'sheets-reader: cabang ranking partial fail',
        );
      }
    }
  }
  rows.sort((a, b) => b.revenue - a.revenue);
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i]!;
    const roasStr = r.roas == null ? 'belum tercatat' : `${r.roas.toFixed(2)}x`;
    lines.push(
      `${i + 1}. ${r.label} — Rev ${formatRupiahLite(r.revenue)} · ROAS ${roasStr}`,
    );
  }
  lines.push('');
  lines.push('Ketik /cabang [nama] untuk detail.');
  return lines.join('\n');
}

function formatRupiahLite(n: number): string {
  return `Rp ${Math.round(n).toLocaleString('id-ID')}`;
}

// ─────────────────── /roas ───────────────────

export async function handleRoasCommand(args: string[]): Promise<string> {
  // /roas                          → list semua cabang
  // /roas pusat                    → today
  // /roas aqiqah pusat 7d          → explicit
  if (args.length === 0) {
    return await rankAllRoas(wibIsoDate(), wibIsoDate());
  }

  let business: Business | null = null;
  let branchInput: string | null = null;
  let periodArgs: string[] = [];

  const first = args[0]!;
  const maybeBiz = parseBusiness(first);
  if (maybeBiz) {
    business = maybeBiz;
    branchInput = args[1] ?? null;
    periodArgs = args.slice(2);
  } else {
    branchInput = first;
    periodArgs = args.slice(1);
  }
  if (!branchInput) {
    return `❌ Cabang belum disebut. Contoh: /roas pusat atau /roas aqiqah jabar 7d`;
  }

  const resolveResult = resolveBranch(branchInput, business ?? undefined);
  if (!resolveResult.ok) {
    if (resolveResult.reason === 'ambiguous') {
      const lines: string[] = [];
      lines.push(`🤔 Cabang "${branchInput.toUpperCase()}" ada di ${resolveResult.matches.length} bisnis:`);
      for (const m of resolveResult.matches) {
        lines.push(`• ${m.business.label} - ${m.branch}`);
      }
      lines.push('');
      lines.push('Spesifikkan bisnisnya:');
      for (const m of resolveResult.matches) {
        lines.push(`  /roas ${m.business.business} ${m.branch.toLowerCase()}`);
      }
      return lines.join('\n');
    }
    return `❌ Cabang "${branchInput}" nggak ditemukan.`;
  }

  const range = parsePeriodArgs(periodArgs);
  if ('error' in range) return `❌ ${range.error}`;

  const rows = await readReportingForBranch(resolveResult.resolved);
  if (range.isSingleDay) {
    const row = pickRowForDate(rows, range.since);
    if (!row) {
      return (
        `ℹ️ ${resolveResult.resolved.business.label} ${resolveResult.resolved.branch}\n` +
        `📅 ${range.since}\n\n` +
        `Belum ada baris untuk tanggal ini.`
      );
    }
    return formatRoasSingle(
      row,
      resolveResult.resolved.business.label,
      resolveResult.resolved.branch,
    );
  }
  const agg = aggregateReporting(rows, range.since, range.until);
  return formatRoasRange(
    agg,
    resolveResult.resolved.business.label,
    resolveResult.resolved.branch,
  );
}

async function rankAllRoas(since: string, until: string): Promise<string> {
  const lines: string[] = [];
  lines.push(`📊 ROAS semua cabang — ${since === until ? since : `${since} → ${until}`}`);
  lines.push('(Source: kolom AN di tab REPORTING masing-masing)');
  lines.push('');
  interface Row {
    label: string;
    roas: number | null;
  }
  const rows: Row[] = [];
  for (const biz of BUSINESSES) {
    for (const b of biz.branches) {
      try {
        const reporting = await readReportingForBranch({
          business: biz,
          branch: b.branch,
          reportingTab: b.reportingTab,
        });
        if (since === until) {
          const r = pickRowForDate(reporting, since);
          rows.push({
            label: `${biz.label} - ${b.branch}`,
            roas: r && !isNoData(r.roas) ? r.roas : null,
          });
        } else {
          const agg = aggregateReporting(reporting, since, until);
          rows.push({
            label: `${biz.label} - ${b.branch}`,
            roas: isNoData(agg.avgRoas.value) ? null : agg.avgRoas.value,
          });
        }
      } catch {
        rows.push({ label: `${biz.label} - ${b.branch}`, roas: null });
      }
    }
  }
  rows.sort((a, b) => (b.roas ?? -1) - (a.roas ?? -1));
  for (const r of rows) {
    const roasStr = r.roas == null ? 'belum tercatat' : `${r.roas.toFixed(2)}x`;
    lines.push(`• ${r.label}: ${roasStr}`);
  }
  return lines.join('\n');
}

// ─────────────────── /tiktok ───────────────────

export async function handleTiktokCommand(args: string[]): Promise<string> {
  if (args.length === 0) {
    return (
      'Usage:\n' +
      '  /tiktok pusat               → TikTok cabang Pusat hari ini\n' +
      '  /tiktok pusat 7d            → 7 hari\n' +
      '  /tiktok aqiqah pusat 30d    → eksplisit bisnis'
    );
  }
  let business: Business | null = null;
  let branchInput: string | null = null;
  let periodArgs: string[] = [];

  const first = args[0]!;
  const maybeBiz = parseBusiness(first);
  if (maybeBiz) {
    business = maybeBiz;
    branchInput = args[1] ?? null;
    periodArgs = args.slice(2);
  } else {
    branchInput = first;
    periodArgs = args.slice(1);
  }
  if (!branchInput) {
    return `❌ Cabang belum disebut. Contoh: /tiktok pusat`;
  }
  const resolveResult = resolveBranch(branchInput, business ?? undefined);
  if (!resolveResult.ok) {
    if (resolveResult.reason === 'ambiguous') {
      const lines: string[] = [];
      lines.push(`🤔 Cabang "${branchInput.toUpperCase()}" ada di ${resolveResult.matches.length} bisnis:`);
      for (const m of resolveResult.matches) {
        lines.push(`• ${m.business.label} - ${m.branch}`);
      }
      lines.push('');
      lines.push('Spesifikkan: /tiktok aqiqah pusat atau /tiktok basmalah pusat');
      return lines.join('\n');
    }
    return `❌ Cabang "${branchInput}" nggak ditemukan.`;
  }
  const range = parsePeriodArgs(periodArgs);
  if ('error' in range) return `❌ ${range.error}`;

  const rows = await readReportingForBranch(resolveResult.resolved);
  if (range.isSingleDay) {
    const row = pickRowForDate(rows, range.since);
    if (!row) {
      return `ℹ️ Belum ada baris ${resolveResult.resolved.branch} untuk ${range.since}.`;
    }
    return formatTiktokSingle(
      row,
      resolveResult.resolved.business.label,
      resolveResult.resolved.branch,
    );
  }
  const agg = aggregateTiktok(rows, range.since, range.until);
  return formatTiktokRange(
    agg,
    resolveResult.resolved.business.label,
    resolveResult.resolved.branch,
  );
}

// ─────────────────── /alert ───────────────────

export async function handleAlertCommand(): Promise<string> {
  const today = wibIsoDate();
  const evaluatedAt = `${today} (WIB)`;

  const { rows: configs, missingTab } = await loadAllAlertConfigs();
  const findings: AlertFinding[] = [];
  let healthyCount = 0;

  for (const biz of BUSINESSES) {
    for (const b of biz.branches) {
      const resolved: ResolvedBranch = {
        business: biz,
        branch: b.branch,
        reportingTab: b.reportingTab,
      };
      const reporting = await readReportingForBranch(resolved);
      const todayRow = pickRowForDate(reporting, today);
      if (!todayRow) continue; // skip cabang yang hari ini belum ada row

      const metrics: Array<{ metric: AlertMetric; value: number | symbol }> = [
        { metric: 'ROAS', value: todayRow.roas },
        { metric: 'CR%', value: todayRow.crMeta },
        { metric: 'CPR', value: todayRow.cprRealWaMeta },
        { metric: 'CAC', value: todayRow.cac },
        { metric: 'SAC', value: todayRow.sac },
      ];

      for (const m of metrics) {
        const cfg = findActiveConfig(configs, biz.business, b.branch, m.metric);
        if (!cfg) continue;
        if (typeof m.value !== 'number') continue;
        const sev = classifySeverity(m.metric, m.value, cfg);
        if (sev === 'ok') {
          healthyCount += 1;
          continue;
        }
        findings.push({
          business: biz.business,
          branch: b.branch,
          metric: m.metric,
          current: m.value,
          config: cfg,
          severity: sev,
        });
      }
    }
  }

  // Sort: critical first then by metric name for stable output.
  findings.sort((a, b) => {
    const sevOrder = (s: typeof a.severity): number =>
      s === 'critical' ? 0 : s === 'warning' ? 1 : 2;
    const cmp = sevOrder(a.severity) - sevOrder(b.severity);
    if (cmp !== 0) return cmp;
    return a.metric.localeCompare(b.metric);
  });

  let report = formatAlertReport(findings, healthyCount, evaluatedAt);
  if (missingTab.length > 0) {
    const lines = missingTab.map((b) => {
      const tabName = `ALERT_CONFIG_${b.business.charAt(0).toUpperCase() + b.business.slice(1)}`;
      return `• ${BUSINESS_LABEL[b.business]} — butuh tab "${tabName}"`;
    });
    report =
      `ℹ️ Tab ALERT_CONFIG belum ditemukan di Sheet berikut:\n${lines.join('\n')}\n\n` +
      `Silakan buat tab manual dengan kolom (di row 4):\n` +
      `   Bisnis | Cabang | Metric | Kritis | Warning | Active\n\n` +
      `Untuk sekarang, alert untuk bisnis di atas akan di-skip ` +
      `(tetap di-cek bisnis lain yang tab-nya sudah ada).\n\n` +
      `────────────────\n\n` +
      report;
  }
  return report;
}

/**
 * Mode "silent kalau aman" buat cron. Return null kalau cuma healthy
 * (no critical, no warning) — caller pakai itu untuk skip kirim message.
 */
export async function evaluateAlertsForCron(): Promise<string | null> {
  const text = await handleAlertCommand();
  // Simple heuristic: text yang start dengan "✅" = healthy/no alert
  // (lihat formatAlertReport). Skip kirim ke group.
  if (text.startsWith('✅')) return null;
  return text;
}

// ─────────────────── /refresh-cs ───────────────────

export function handleRefreshCs(): string {
  clearCsCache();
  return '✅ Cache CS di-clear. Query selanjutnya akan refresh dari Sheet.';
}
