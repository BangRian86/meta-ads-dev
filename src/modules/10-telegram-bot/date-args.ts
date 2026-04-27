import { normalizeDateArg } from '../13-sheets-integration/index.js';

export interface ParsedRange {
  since: string; // YYYY-MM-DD
  until: string; // YYYY-MM-DD
  /** Display label, e.g. "7d", "24 Apr", "01 Apr → 15 Apr". */
  label: string;
}

export type ParseRangeResult =
  | { ok: true; range: ParsedRange }
  | { ok: false; reason: string };

export interface ParseRangeOpts {
  /** N used when args is empty. Default 7 — caller can override. */
  defaultDays?: number;
  /** Cap so a stray "10000d" doesn't blow up Meta call volume. */
  maxDays?: number;
}

/**
 * Parses date-range args from a Telegram command. Accepted shapes:
 *
 *   []                          → last <defaultDays> days ending today
 *   ["7d"] / ["30d"]            → last N days ending today
 *   ["24apr"] / ["2026-04-24"]  → that single day (since == until)
 *   ["1apr", "15apr"]           → inclusive range
 *   ["2026-04-01", "2026-04-15"] → inclusive range
 *
 * Returns an error result with a human-friendly Indonesian reason when the
 * args don't parse — the caller should send `reason` straight back to Telegram.
 */
export function parseDateRange(
  args: string[],
  opts: ParseRangeOpts = {},
): ParseRangeResult {
  const defaultDays = opts.defaultDays ?? 7;
  const maxDays = opts.maxDays ?? 365;

  if (args.length === 0) {
    return { ok: true, range: relativeDaysRange(defaultDays) };
  }

  if (args.length === 1) {
    const a = args[0]!.trim();
    const m = /^(\d+)d$/i.exec(a);
    if (m) {
      const n = Number(m[1]);
      if (!Number.isInteger(n) || n < 1 || n > maxDays) {
        return { ok: false, reason: `Periode harus 1d – ${maxDays}d.` };
      }
      return { ok: true, range: relativeDaysRange(n) };
    }
    const iso = normalizeDateArg(a);
    if (iso) {
      return { ok: true, range: { since: iso, until: iso, label: iso } };
    }
    return {
      ok: false,
      reason: `Tidak mengenali "${a}". Contoh: 7d, 30d, 24Apr, 2026-04-24.`,
    };
  }

  if (args.length === 2) {
    const [s, u] = args as [string, string];
    const iso1 = normalizeDateArg(s);
    const iso2 = normalizeDateArg(u);
    if (!iso1 || !iso2) {
      return {
        ok: false,
        reason:
          'Format tanggal salah. Contoh: /roas 1Apr 15Apr atau /roas 2026-04-01 2026-04-15.',
      };
    }
    if (iso1 > iso2) {
      return {
        ok: false,
        reason: `Tanggal awal (${iso1}) harus <= tanggal akhir (${iso2}).`,
      };
    }
    const span =
      Math.floor(
        (Date.parse(iso2) - Date.parse(iso1)) / (24 * 60 * 60 * 1000),
      ) + 1;
    if (span > maxDays) {
      return {
        ok: false,
        reason: `Range terlalu lebar (${span} hari). Maksimum ${maxDays} hari.`,
      };
    }
    return {
      ok: true,
      range: { since: iso1, until: iso2, label: `${iso1} → ${iso2}` },
    };
  }

  return {
    ok: false,
    reason:
      'Terlalu banyak argumen. Pakai: kosong / Nd / satu tanggal / dua tanggal.',
  };
}

function relativeDaysRange(days: number): ParsedRange {
  const until = isoDateOffset(0);
  const since = isoDateOffset(-(days - 1));
  const label = days === 1 ? until : `${days}d (${since} → ${until})`;
  return { since, until, label };
}

function isoDateOffset(daysFromToday: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromToday);
  return d.toISOString().slice(0, 10);
}
