import type {
  AlertWindow,
  CampaignAlert,
  EvaluationResult,
} from './alert-engine.js';
import type { Business } from './threshold-config.js';

// ---------- Label data (TIDAK divariasi — biar konsisten) ----------

const WINDOW_LABEL: Record<AlertWindow, string> = {
  daily: 'hari ini',
  weekly: '7 hari terakhir',
  monthly: '30 hari terakhir',
};

const WINDOW_NOUN: Record<AlertWindow, string> = {
  daily: 'harian',
  weekly: 'mingguan',
  monthly: 'bulanan',
};

const BUSINESS_LABEL: Record<Business, string> = {
  basmalah: 'Basmalah Travel',
  aqiqah: 'Aqiqah Express',
};

// ---------- Template pools (DIPILIH RANDOM per output) ----------
//
// Tone bervariasi: ada yang formal-tegas, ada yang santai kayak ngobrol WA,
// ada yang netral profesional. Tujuannya biar message nggak kerasa robot.
// Setiap pool minimal 3 variasi sesuai requirement.

const HEADER_TEMPLATES: ReadonlyArray<(business: string) => string> = [
  (b) => `🚨 ADA YANG PERLU DICEK — ${b}`,
  (b) => `🚨 Bang, ada yang perlu diliatin — ${b}`,
  (b) => `🚨 ALERT — ${b}`,
  (b) => `🚨 Lagi nggak sehat nih — ${b}`,
  (b) => `🚨 Butuh perhatian segera — ${b}`,
];

const PERIOD_TEMPLATES: ReadonlyArray<
  (window: AlertWindow, today: string) => string
> = [
  (w, t) => `Periode: ${WINDOW_LABEL[w]} (${t})`,
  (w, t) => `Cek ${WINDOW_LABEL[w]} (${t})`,
  (w, t) => `${t} | ${WINDOW_LABEL[w]}`,
  (w, t) => `Window ${WINDOW_NOUN[w]} — ${t}`,
];

const CRITICAL_SECTION_TITLES: ReadonlyArray<(count: number) => string> = [
  (n) => `🔴 KRITIS (${n} campaign):`,
  (n) => `🔴 Lagi nggak sehat (${n} campaign):`,
  (n) => `🔴 KRITIS (${n}):`,
  (n) => `🔴 Butuh action sekarang (${n} campaign):`,
];

const WARNING_SECTION_TITLES: ReadonlyArray<(count: number) => string> = [
  (n) => `🟡 WARNING (${n} campaign):`,
  (n) => `🟡 Mulai turun (${n} campaign):`,
  (n) => `🟡 Pantau dulu (${n}):`,
  (n) => `🟡 Belum kritis tapi watch (${n} campaign):`,
];

// Per-alert phrasing untuk baris ROAS — picked sekali per evaluation result
// (tiap alert dalam satu message pakai gaya yang sama biar nggak chaos).
const ROAS_LINE_TEMPLATES: ReadonlyArray<
  (roas: number, target: number) => string
> = [
  (r, t) => `ROAS cuma ${fmtRoas(r)} — harusnya minimal ${fmtRoas(t)}`,
  (r, t) => `ROAS-nya ${fmtRoas(r)} doang, padahal target minimal ${fmtRoas(t)}`,
  (r, t) => `ROAS ${fmtRoas(r)} | Target: ${fmtRoas(t)}`,
  (r, t) => `ROAS ${fmtRoas(r)} (di bawah batas minimum ${fmtRoas(t)})`,
];

// Per-alert phrasing untuk baris money.
const MONEY_LINE_TEMPLATES: ReadonlyArray<
  (spend: number, revenue: number) => string
> = [
  (s, r) => `Sudah habis ${fmtIdr(s)}, baru hasilkan ${fmtIdr(r)}`,
  (s, r) => `Spend: ${fmtIdr(s)} | Revenue: ${fmtIdr(r)}`,
  (s, r) => `Habis ${fmtIdr(s)}, return ${fmtIdr(r)}`,
];

const ACTION_TEMPLATES: readonly string[] = [
  '💡 Saran: Coba review creative-nya dulu, atau pause sementara biar nggak boros lebih banyak.',
  '💡 Mending di-pause dulu deh, atau ganti creative-nya.',
  '⚡ ACTION: Pause atau ganti creative sekarang.',
  '💡 Cek dulu ad set-nya, kalau emang nggak performing tinggal pause.',
  '⚡ Action diperlukan: review atau pause campaign ini.',
];

const HEALTHY_TEMPLATES: ReadonlyArray<
  (window: AlertWindow, business: Business, count: number) => string
> = [
  (w, b, n) =>
    [
      `✅ Aman semua, Bang!`,
      `Periode: ${WINDOW_LABEL[w]}`,
      `Bisnis: ${BUSINESS_LABEL[b]}`,
      `${n} campaign aktif, semua di atas batas minimum.`,
    ].join('\n'),
  (w, b, n) =>
    [
      `✅ Performance lagi bagus`,
      `${todayLabel()} — cek ${WINDOW_NOUN[w]}`,
      `${BUSINESS_LABEL[b]}: ${n} campaign aktif, semua healthy.`,
    ].join('\n'),
  (w, b, n) =>
    [
      `✅ Tidak ada alert untuk window ini.`,
      `Window: ${WINDOW_LABEL[w]} | Bisnis: ${BUSINESS_LABEL[b]} | Active: ${n} | Status: All healthy`,
    ].join('\n'),
  (w, b, n) =>
    [
      `✅ Semua campaign healthy 👌`,
      `${BUSINESS_LABEL[b]} — ${WINDOW_LABEL[w]}`,
      `Total ${n} campaign aktif, nggak ada yang kritis.`,
    ].join('\n'),
];

const NO_BUSINESS_TEMPLATES: ReadonlyArray<
  (business: Business, window: AlertWindow, count: number) => string
> = [
  (b, w, n) =>
    [
      `ℹ️ Belum ada data closing untuk ${BUSINESS_LABEL[b]} di periode ini.`,
      `Periode: ${WINDOW_LABEL[w]}`,
      `Sistem skip ${n} campaign sampai ada closing yang masuk Sheets.`,
    ].join('\n'),
  (b, w, n) =>
    [
      `ℹ️ ${BUSINESS_LABEL[b]}: belum ada closing yang ke-log`,
      `Cek Sheet-nya, Bang — mungkin ada yang belum di-input?`,
      `(${n} campaign aktif di window ${WINDOW_LABEL[w]}, tapi ROAS belum bisa dihitung)`,
    ].join('\n'),
  (b, w, n) =>
    [
      `ℹ️ Skip cek ${BUSINESS_LABEL[b]} — 0 closing terdeteksi ${WINDOW_LABEL[w]}.`,
      `Bisa jadi memang belum ada, atau CS belum input ke Sheets.`,
      `${n} campaign aktif tapi belum bisa di-evaluasi.`,
    ].join('\n'),
];

// ---------- Helpers ----------

/**
 * Picks one item from a non-empty array. The non-null assertion is safe
 * karena semua pool di file ini ditulis manual dengan minimal 3 entri.
 */
function pickRandom<T>(arr: ReadonlyArray<T>): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function fmtIdr(n: number): string {
  // toLocaleString('id-ID') → "1.750.000" (titik sebagai pemisah ribuan,
  // sesuai standar Indonesia). JANGAN diubah ke koma.
  return `Rp ${Math.round(n).toLocaleString('id-ID')}`;
}

function fmtRoas(n: number): string {
  // Selalu 1 desimal + lowercase "x" — konsisten meski text variasi.
  return `${n.toFixed(1)}x`;
}

function todayLabel(): string {
  // "26 Apr 2026" — format singkat Bahasa Indonesia.
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
    'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des',
  ];
  const d = new Date();
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function renderAlertLines(
  alert: CampaignAlert,
  roasFormatter: (typeof ROAS_LINE_TEMPLATES)[number],
  moneyFormatter: (typeof MONEY_LINE_TEMPLATES)[number],
): string[] {
  // Threshold yang relevan: kalau severity critical, banding ke critical;
  // kalau warning, banding ke warning.
  const target =
    alert.severity === 'critical'
      ? alert.threshold_critical
      : alert.threshold_warning;
  return [
    `  • ${alert.campaign_name} [${alert.campaign_type}]`,
    `    ${roasFormatter(alert.roas, target)}`,
    `    ${moneyFormatter(alert.spend, alert.revenue)}`,
  ];
}

// ---------- Public API (signature unchanged) ----------

/**
 * Renders one EvaluationResult ke message Telegram dalam Bahasa Indonesia.
 * Returns null kalau tidak ada alert DAN `includeHealthyMessage` false —
 * itu mode "diam kalau nggak ada yang perlu di-action" buat cron.
 */
export function formatEvaluationResult(
  r: EvaluationResult,
  opts: { includeHealthyMessage?: boolean } = {},
): string | null {
  // Branch khusus: account belum punya data closing di Sheets sama sekali.
  // Lebih informatif daripada "all healthy" kalau memang belum ada apa-apa.
  if (
    r.alerts.length === 0 &&
    r.healthyCount === 0 &&
    r.noBusinessCount > 0
  ) {
    if (!opts.includeHealthyMessage) return null;
    return pickRandom(NO_BUSINESS_TEMPLATES)(
      r.business,
      r.window,
      r.noBusinessCount,
    );
  }

  if (r.alerts.length === 0) {
    if (!opts.includeHealthyMessage) return null;
    return pickRandom(HEALTHY_TEMPLATES)(r.window, r.business, r.healthyCount);
  }

  const critical = r.alerts.filter((a) => a.severity === 'critical');
  const warning = r.alerts.filter((a) => a.severity === 'warning');

  // Pilih sekali per message — biar phrasing konsisten dalam satu message.
  const header = pickRandom(HEADER_TEMPLATES)(BUSINESS_LABEL[r.business]);
  const period = pickRandom(PERIOD_TEMPLATES)(r.window, todayLabel());
  const action = pickRandom(ACTION_TEMPLATES);
  const roasFormatter = pickRandom(ROAS_LINE_TEMPLATES);
  const moneyFormatter = pickRandom(MONEY_LINE_TEMPLATES);

  const lines: string[] = [];
  lines.push(header);
  lines.push(period);
  lines.push('');

  if (critical.length > 0) {
    lines.push(pickRandom(CRITICAL_SECTION_TITLES)(critical.length));
    for (const a of critical) {
      lines.push(...renderAlertLines(a, roasFormatter, moneyFormatter));
    }
    lines.push('');
  }
  if (warning.length > 0) {
    lines.push(pickRandom(WARNING_SECTION_TITLES)(warning.length));
    for (const a of warning) {
      lines.push(...renderAlertLines(a, roasFormatter, moneyFormatter));
    }
    lines.push('');
  }

  // Footer summary — angka tetap konsisten meski kalimat variasi.
  if (r.healthyCount > 0) {
    lines.push(`✅ Yang masih aman: ${r.healthyCount} campaign`);
  }
  if (r.belowMinSpendCount > 0) {
    lines.push(
      `(${r.belowMinSpendCount} campaign di bawah min-spend Rp 50.000, di-skip)`,
    );
  }
  if (r.noBusinessCount > 0) {
    lines.push(
      `(${r.noBusinessCount} campaign tanpa data revenue Sheets, di-skip)`,
    );
  }
  lines.push('');
  lines.push(action);

  return lines.join('\n');
}

/**
 * Render multi-business sekaligus, satu section per business. Returns null
 * kalau semuanya kosong (mode silent buat cron).
 */
export function formatMultipleResults(
  results: EvaluationResult[],
  opts: { includeHealthyMessage?: boolean } = {},
): string | null {
  const sections: string[] = [];
  for (const r of results) {
    const s = formatEvaluationResult(r, opts);
    if (s) sections.push(s);
  }
  if (sections.length === 0) return null;
  return sections.join('\n\n────────────────\n\n');
}
