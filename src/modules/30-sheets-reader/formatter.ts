import type {
  AlertConfigRow,
  AlertMetric,
} from './alert-config.js';
import type { CsAggregate, CsPerformRow, CsRankingRow } from './cs-data.js';
import type {
  ReportingAggregate,
  ReportingRow,
  TiktokAggregate,
} from './reporting-data.js';
import { isNoData, NO_DATA, type NoData } from './cell-utils.js';
import type { Business } from './business-resolver.js';

// ─────────────────── Number / unit formatters ───────────────────

export function fmtIdr(v: number | NoData): string {
  if (isNoData(v)) return 'belum tercatat';
  return `Rp ${Math.round(v).toLocaleString('id-ID')}`;
}

export function fmtRoas(v: number | NoData): string {
  if (isNoData(v)) return 'belum tercatat';
  return `${v.toFixed(2)}x`;
}

export function fmtPct(v: number | NoData): string {
  if (isNoData(v)) return 'belum tercatat';
  // Sheets sometimes returns 0.143 (fraction) and sometimes 14.3 (percent).
  // Heuristik: kalau ≤ 1, treat sebagai fraction.
  const pct = v <= 1 ? v * 100 : v;
  return `${pct.toFixed(1)}%`;
}

export function fmtNumber(v: number | NoData): string {
  if (isNoData(v)) return 'belum tercatat';
  return Math.round(v).toLocaleString('id-ID');
}

const ID_MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
  'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des',
];

export function fmtIsoDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  const mi = Number(m) - 1;
  return `${Number(d)} ${ID_MONTHS[mi] ?? m} ${y}`;
}

export function fmtRangeLabel(start: string, end: string): string {
  if (start === end) return fmtIsoDate(start);
  // Same month: "1-15 Apr 2026"; cross month: "28 Mar - 15 Apr 2026"
  const [ys, ms, ds] = start.split('-');
  const [ye, me, de] = end.split('-');
  if (ys === ye && ms === me) {
    return `${Number(ds)}-${Number(de)} ${ID_MONTHS[Number(ms) - 1]} ${ys}`;
  }
  if (ys === ye) {
    return `${Number(ds)} ${ID_MONTHS[Number(ms) - 1]} - ${Number(de)} ${ID_MONTHS[Number(me) - 1]} ${ys}`;
  }
  return `${fmtIsoDate(start)} - ${fmtIsoDate(end)}`;
}

const BUSINESS_LABEL: Record<Business, string> = {
  basmalah: 'Basmalah Travel',
  aqiqah: 'Aqiqah Express',
};

// ─────────────────── /cs formatters ───────────────────

export function formatCsSingle(
  row: CsPerformRow,
): string {
  const lines: string[] = [];
  lines.push(`👤 ${row.csName} (${row.contextLabel}${row.branch ? ' — ' + row.branch : ''})`);
  lines.push(`📅 ${fmtIsoDate(row.isoDate)}`);
  lines.push('');
  lines.push('📊 Performance:');
  lines.push(`• Chat: ${fmtNumber(row.chat)}`);
  lines.push(`• Closing: ${fmtNumber(row.closing)}`);
  lines.push(`• Ekor: ${fmtNumber(row.ekor)}`);
  lines.push(`• Revenue: ${fmtIdr(row.revenue)}`);
  lines.push('');
  lines.push('💰 Cost metrics:');
  lines.push(`• Biaya per CS: ${fmtIdr(row.biayaPerCs)}`);
  lines.push(`• CAC: ${fmtIdr(row.cac)}`);
  lines.push(`• SAC: ${fmtIdr(row.sac)}`);
  if (!isNoData(row.chat) && !isNoData(row.closing) && row.chat > 0) {
    const cr = (row.closing / row.chat) * 100;
    lines.push('');
    lines.push(`📈 Closing rate: ${cr.toFixed(1)}%`);
  }
  return lines.join('\n');
}

export function formatCsAggregate(agg: CsAggregate): string {
  const lines: string[] = [];
  lines.push(`👤 ${agg.csName} (${agg.contextLabel}${agg.branch ? ' — ' + agg.branch : ''})`);
  lines.push(`📅 ${fmtRangeLabel(agg.rangeStart, agg.rangeEnd)} (${agg.daysWithData} hari ada data)`);
  lines.push('');
  lines.push('📊 Total performance:');
  lines.push(`• Chat: ${fmtNumber(agg.totalChat)}`);
  lines.push(`• Closing: ${fmtNumber(agg.totalClosing)}`);
  lines.push(`• Ekor: ${fmtNumber(agg.totalEkor)}`);
  lines.push(`• Revenue: ${fmtIdr(agg.totalRevenue)}`);
  lines.push('');
  lines.push('💰 Cost metrics (sum):');
  lines.push(`• Total biaya CS: ${fmtIdr(agg.totalBiayaCs)}`);
  lines.push('');
  lines.push('💰 Cost metrics (rata-rata harian):');
  lines.push(`• Avg CAC: ${fmtIdr(agg.avgCac)}`);
  lines.push(`• Avg SAC: ${fmtIdr(agg.avgSac)}`);
  lines.push('');
  lines.push(`📈 Closing rate: ${agg.closingRatePct.toFixed(1)}%`);
  return lines.join('\n');
}

export function formatCsRanking(
  rows: CsRankingRow[],
  rangeStart: string,
  rangeEnd: string,
): string {
  if (rows.length === 0) {
    return `Belum ada CS dengan data di periode ${fmtRangeLabel(rangeStart, rangeEnd)}.`;
  }
  const lines: string[] = [];
  lines.push(`👥 Semua CS — ${fmtRangeLabel(rangeStart, rangeEnd)}`);
  lines.push('');
  lines.push('🏆 Ranking by Revenue:');
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i]!;
    const tag = `${BUSINESS_LABEL[r.business]}${r.branch ? ' ' + r.branch : ''}`;
    lines.push(
      `${i + 1}. ${r.csName} (${tag}) — ${fmtIdr(r.totalRevenue)} (${r.totalClosing} closing)`,
    );
  }
  lines.push('');
  lines.push('Ketik /cs [nama] untuk detail.');
  return lines.join('\n');
}

// ─────────────────── /cabang formatter ───────────────────

export function formatCabangSingle(
  row: ReportingRow,
  contextLabel: string,
  branch: string,
): string {
  const lines: string[] = [];
  lines.push(`🏢 ${contextLabel} — ${branch}`);
  lines.push(`📅 ${fmtIsoDate(row.isoDate)}`);
  lines.push('');
  lines.push('📊 Total cabang:');
  lines.push(`• ATC iklan: ${fmtNumber(row.totalAtc)}`);
  lines.push(`• Real chat: ${fmtNumber(row.totalChat)}`);
  lines.push(`• Closing: ${fmtNumber(row.totalClosing)}`);
  lines.push(`• Ekor: ${fmtNumber(row.totalEkor)}`);
  lines.push(`• Revenue: ${fmtIdr(row.revenue)}`);
  lines.push('');
  lines.push('💰 Biaya iklan:');
  lines.push(`• Meta: ${fmtIdr(row.biayaMetaRaw)} (+ pajak ${fmtIdr(row.pajakMeta)})`);
  if (!isNoData(row.biayaTiktokRaw) && row.biayaTiktokRaw > 0) {
    lines.push(`• TikTok: ${fmtIdr(row.biayaTiktokRaw)} (+ pajak ${fmtIdr(row.pajakTiktok)})`);
  }
  if (!isNoData(row.biayaGoogleRaw) && row.biayaGoogleRaw > 0) {
    lines.push(`• Google: ${fmtIdr(row.biayaGoogleRaw)} (+ pajak ${fmtIdr(row.pajakGoogle)})`);
  }
  lines.push(`• Total: ${fmtIdr(row.totalBiayaIklan)}`);
  lines.push('');
  lines.push('📈 Metrik (langsung dari Sheet):');
  lines.push(`• ROAS: ${fmtRoas(row.roas)}`);
  lines.push(`• CR % (Meta): ${fmtPct(row.crMeta)}`);
  lines.push(`• Cost per Conversation: ${fmtIdr(row.costPerConversation)}`);
  lines.push(`• CAC: ${fmtIdr(row.cac)}`);
  lines.push(`• SAC: ${fmtIdr(row.sac)}`);
  return lines.join('\n');
}

export function formatCabangAggregate(
  agg: ReportingAggregate,
  contextLabel: string,
  branch: string,
): string {
  const lines: string[] = [];
  lines.push(`🏢 ${contextLabel} — ${branch}`);
  lines.push(`📅 ${fmtRangeLabel(agg.rangeStart, agg.rangeEnd)} (${agg.daysWithData} hari ada data)`);
  lines.push('');
  lines.push('📊 Total cabang (sum):');
  lines.push(`• ATC iklan: ${fmtNumber(agg.totalAtc.value)}`);
  lines.push(`• Real chat: ${fmtNumber(agg.totalChat.value)}`);
  lines.push(`• Closing: ${fmtNumber(agg.totalClosing.value)}`);
  lines.push(`• Ekor: ${fmtNumber(agg.totalEkor.value)}`);
  lines.push(`• Revenue: ${fmtIdr(agg.totalRevenue.value)}`);
  lines.push(`• Total biaya iklan: ${fmtIdr(agg.totalBiayaIklan.value)}`);
  lines.push('');
  lines.push('📈 ROAS rata-rata harian (avg dari kolom AN):');
  lines.push(`• ROAS: ${fmtRoas(agg.avgRoas.value)}`);
  return lines.join('\n');
}

// ─────────────────── /roas formatters ───────────────────

export function formatRoasSingle(
  row: ReportingRow,
  contextLabel: string,
  branch: string,
): string {
  const lines: string[] = [];
  lines.push(`📊 ROAS — ${contextLabel} ${branch}`);
  lines.push(`📅 ${fmtIsoDate(row.isoDate)}`);
  lines.push('');
  lines.push(`ROAS: ${fmtRoas(row.roas)}`);
  lines.push(`Sumber: ${branch}-REPORTING kolom AN, baris ${fmtIsoDate(row.isoDate)}`);
  lines.push('');
  lines.push('Supporting data:');
  lines.push(`• Total biaya iklan: ${fmtIdr(row.totalBiayaIklan)}`);
  lines.push(`• Revenue: ${fmtIdr(row.revenue)}`);
  return lines.join('\n');
}

export function formatRoasRange(
  agg: ReportingAggregate,
  contextLabel: string,
  branch: string,
): string {
  const lines: string[] = [];
  lines.push(`📊 ROAS — ${contextLabel} ${branch}`);
  lines.push(`📅 ${fmtRangeLabel(agg.rangeStart, agg.rangeEnd)}`);
  lines.push('');
  lines.push(`ROAS rata-rata: ${fmtRoas(agg.avgRoas.value)}`);
  lines.push(`(Average dari ${agg.avgRoas.days} nilai harian di kolom AN)`);
  if (agg.perDayRoas.length > 0) {
    lines.push('');
    lines.push('Per hari:');
    for (const d of agg.perDayRoas.slice().reverse().slice(0, 14)) {
      lines.push(`• ${fmtIsoDate(d.isoDate)}: ${fmtRoas(d.roas)}`);
    }
    if (agg.perDayRoas.length > 14) {
      lines.push(`(${agg.perDayRoas.length - 14} hari sebelumnya tidak ditampilkan)`);
    }
    const valid = agg.perDayRoas.filter((d) => !isNoData(d.roas));
    if (valid.length > 0) {
      const sorted = [...valid].sort((a, b) => (b.roas as number) - (a.roas as number));
      const hi = sorted[0]!;
      const lo = sorted[sorted.length - 1]!;
      lines.push('');
      lines.push(`Highest: ${fmtRoas(hi.roas)} (${fmtIsoDate(hi.isoDate)})`);
      lines.push(`Lowest: ${fmtRoas(lo.roas)} (${fmtIsoDate(lo.isoDate)})`);
    }
  }
  return lines.join('\n');
}

// ─────────────────── /tiktok formatter ───────────────────

export function formatTiktokSingle(
  row: ReportingRow,
  contextLabel: string,
  branch: string,
): string {
  const lines: string[] = [];
  lines.push(`📱 TikTok — ${contextLabel} ${branch}`);
  lines.push(`📅 ${fmtIsoDate(row.isoDate)}`);
  lines.push('');
  lines.push('📊 Performance TikTok:');
  lines.push(`• ATC iklan: ${fmtNumber(row.atcTiktok)}`);
  lines.push(`• Real chat: ${fmtNumber(row.chatTiktok)}`);
  lines.push(`• Closing: ${fmtNumber(row.closingTiktok)}`);
  lines.push('');
  lines.push('💰 Biaya:');
  lines.push(`• TikTok: ${fmtIdr(row.biayaTiktokRaw)}`);
  lines.push(`• Pajak (11%): ${fmtIdr(row.pajakTiktok)}`);
  if (!isNoData(row.biayaTiktokRaw) && !isNoData(row.pajakTiktok)) {
    const total = row.biayaTiktokRaw + row.pajakTiktok;
    lines.push(`• Total: ${fmtIdr(total)}`);
  }
  lines.push('');
  lines.push('📈 Metrik:');
  lines.push(`• ATC → WA: ${fmtPct(row.atcToWaTiktok)}`);
  lines.push(`• CR % (chat → closing): ${fmtPct(row.crTiktok)}`);
  lines.push(`• CPR Real WA: ${fmtIdr(row.cprRealWaTiktok)}`);
  lines.push('');
  lines.push('💡 Bandingkan vs channel lain: /cabang ' + branch.toLowerCase());
  return lines.join('\n');
}

export function formatTiktokRange(
  agg: TiktokAggregate,
  contextLabel: string,
  branch: string,
): string {
  const lines: string[] = [];
  lines.push(`📱 TikTok — ${contextLabel} ${branch}`);
  lines.push(`📅 ${fmtRangeLabel(agg.rangeStart, agg.rangeEnd)} (${agg.daysWithData} hari ada data)`);
  lines.push('');
  lines.push('📊 Total TikTok (sum):');
  lines.push(`• ATC iklan: ${fmtNumber(agg.totalAtc.value)}`);
  lines.push(`• Real chat: ${fmtNumber(agg.totalChat.value)}`);
  lines.push(`• Closing: ${fmtNumber(agg.totalClosing.value)}`);
  lines.push('');
  lines.push('💰 Biaya:');
  lines.push(`• TikTok: ${fmtIdr(agg.totalBiayaTiktok.value)}`);
  lines.push(`• Pajak: ${fmtIdr(agg.totalPajakTiktok.value)}`);
  lines.push('');
  lines.push('📈 Metrik (rata-rata harian):');
  lines.push(`• ATC → WA: ${fmtPct(agg.avgAtcToWa.value)}`);
  lines.push(`• CR %: ${fmtPct(agg.avgCrTiktok.value)}`);
  lines.push(`• CPR Real WA: ${fmtIdr(agg.avgCprRealWa.value)}`);
  return lines.join('\n');
}

// ─────────────────── /alert formatter ───────────────────

export type Severity = 'critical' | 'warning' | 'ok';

export interface AlertFinding {
  business: Business;
  branch: string;
  metric: AlertMetric;
  current: number;
  config: AlertConfigRow;
  severity: Severity;
}

export function classifySeverity(
  metric: AlertMetric,
  current: number,
  config: AlertConfigRow,
): Severity {
  // Untuk ROAS / CR%: makin kecil makin buruk → critical kalau < kritis.
  // Untuk CPR / CAC / SAC: makin besar makin buruk → critical kalau > kritis.
  // Tapi spec menetapkan "warning" sebagai threshold yang lebih ketat
  // (e.g. CPR warning 30k, kritis 50k berarti warning fires lebih dulu
  // pada 35k, kritis pada 60k). Implementasi:
  //   - higher-is-better metrics (ROAS, CR%): critical = current < kritis
  //     (kritis < warning). Warning = current < warning.
  //   - lower-is-better metrics (CPR, CAC, SAC): critical = current > kritis
  //     (kritis > warning). Warning = current > warning.
  const higherIsBetter = metric === 'ROAS' || metric === 'CR%';
  if (higherIsBetter) {
    if (current < config.kritis) return 'critical';
    if (current < config.warning) return 'warning';
    return 'ok';
  }
  if (current > config.kritis) return 'critical';
  if (current > config.warning) return 'warning';
  return 'ok';
}

export function formatAlertReport(
  findings: AlertFinding[],
  healthyCount: number,
  evaluatedAt: string,
): string {
  const critical = findings.filter((f) => f.severity === 'critical');
  const warning = findings.filter((f) => f.severity === 'warning');

  if (critical.length === 0 && warning.length === 0) {
    return [
      `✅ Semua angka aman per ${evaluatedAt}.`,
      `Total ${healthyCount} metric × cabang di-cek, semua di atas threshold.`,
      '',
      '💡 Edit threshold di tab ALERT_CONFIG di Sheet kalau ingin adjust.',
    ].join('\n');
  }

  const lines: string[] = [];
  lines.push(`🚨 Alert Check — ${evaluatedAt}`);
  lines.push('');

  if (critical.length > 0) {
    lines.push(`🔴 KRITIS (${critical.length}):`);
    for (const f of critical) lines.push(...renderFinding(f));
    lines.push('');
  }
  if (warning.length > 0) {
    lines.push(`⚠️ WARNING (${warning.length}):`);
    for (const f of warning) lines.push(...renderFinding(f));
    lines.push('');
  }
  lines.push(`✅ Healthy: ${healthyCount} metric`);
  lines.push('');
  lines.push('💡 Edit threshold di tab ALERT_CONFIG di Sheet');
  return lines.join('\n');
}

function renderFinding(f: AlertFinding): string[] {
  const valueStr = renderMetricValue(f.metric, f.current);
  const thresholdStr = renderMetricValue(
    f.metric,
    f.severity === 'critical' ? f.config.kritis : f.config.warning,
  );
  const direction =
    f.metric === 'ROAS' || f.metric === 'CR%' ? '<' : '>';
  return [
    `• ${BUSINESS_LABEL[f.business]} ${f.branch} — ${f.metric}`,
    `  Saat ini: ${valueStr} (${f.severity}: ${direction}${thresholdStr})`,
    `  Sumber: ${f.branch}-REPORTING, hari ini`,
  ];
}

function renderMetricValue(metric: AlertMetric, v: number): string {
  if (metric === 'ROAS') return fmtRoas(v);
  if (metric === 'CR%') return fmtPct(v);
  return fmtIdr(v);
}

// ─────────────────── Empty data graceful template ───────────────────

export function formatEmptyDataNotice(
  contextLabel: string,
  branch: string,
  rangeLabel: string,
  available: string[],
  missing: string[],
  hint: string,
): string {
  const lines: string[] = [];
  lines.push(`ℹ️ ${contextLabel}${branch ? ' ' + branch : ''} — ${rangeLabel}`);
  lines.push('');
  if (available.length > 0) {
    lines.push('📊 Yang tersedia:');
    for (const a of available) lines.push(`• ${a}`);
    lines.push('');
  }
  if (missing.length > 0) {
    lines.push('⏳ Belum tercatat:');
    for (const m of missing) lines.push(`• ${m}`);
    lines.push('');
  }
  lines.push(`💡 ${hint}`);
  return lines.join('\n');
}
