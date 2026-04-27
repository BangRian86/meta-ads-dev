/**
 * Mapping antara nama bisnis/cabang yang user ketik di Telegram → ID
 * spreadsheet + nama tab di Google Sheets.
 *
 * Sumber kebenaran: 2 spreadsheet milik Bang Rian (Aqiqah Express &
 * Basmalah Travel). Aqiqah punya 4 cabang (PUSAT/JABAR/JATIM/JOGJA),
 * Basmalah cuma PUSAT.
 */

export type Business = 'aqiqah' | 'basmalah';
export type Branch = 'PUSAT' | 'JABAR' | 'JATIM' | 'JOGJA';

export interface BusinessSheet {
  business: Business;
  /** Display label, dipakai di header output Telegram. */
  label: string;
  spreadsheetId: string;
  /** Cabang yang valid + nama tab REPORTING-nya. */
  branches: Array<{ branch: Branch; reportingTab: string }>;
}

export const BUSINESSES: readonly BusinessSheet[] = [
  {
    business: 'aqiqah',
    label: 'Aqiqah Express',
    spreadsheetId: '1KES1HBKuR7fXgfYV7c5b2tYcsazahcu08gH_Aibdh7c',
    branches: [
      { branch: 'PUSAT', reportingTab: 'PUSAT - REPORTING' },
      { branch: 'JABAR', reportingTab: 'JABAR - REPORTING' },
      { branch: 'JATIM', reportingTab: 'JATIM - REPORTING' },
      { branch: 'JOGJA', reportingTab: 'JOGJA - REPORTING' },
    ],
  },
  {
    business: 'basmalah',
    label: 'Basmalah Travel',
    spreadsheetId: '1z6hCUAvzoTHwcmI9Sg3bN2VmEIhPw6cvCTGZYhBHIwE',
    branches: [{ branch: 'PUSAT', reportingTab: 'PUSAT - REPORTING' }],
  },
];

export function getBusiness(business: Business): BusinessSheet {
  const b = BUSINESSES.find((x) => x.business === business);
  if (!b) throw new Error(`Unknown business: ${business}`);
  return b;
}

/** Semua spreadsheet yang dimanage. Useful buat /cs (cross-spreadsheet). */
export function listSpreadsheets(): BusinessSheet[] {
  return [...BUSINESSES];
}

export interface ResolvedBranch {
  business: BusinessSheet;
  branch: Branch;
  reportingTab: string;
}

/**
 * Cari cabang berdasarkan input user. Kalau `businessHint` diberikan,
 * cuma cek di bisnis itu. Kalau tidak, cek SEMUA bisnis dan return
 * ambiguous result kalau ketemu di lebih dari satu.
 */
export type ResolveBranchResult =
  | { ok: true; resolved: ResolvedBranch }
  | { ok: false; reason: 'not_found' | 'ambiguous'; matches: ResolvedBranch[] };

export function resolveBranch(
  branchInput: string,
  businessHint?: Business,
): ResolveBranchResult {
  const upper = branchInput.toUpperCase();
  const candidates = businessHint
    ? [getBusiness(businessHint)]
    : [...BUSINESSES];

  const matches: ResolvedBranch[] = [];
  for (const biz of candidates) {
    for (const b of biz.branches) {
      if (b.branch === upper) {
        matches.push({
          business: biz,
          branch: b.branch,
          reportingTab: b.reportingTab,
        });
      }
    }
  }

  if (matches.length === 0) {
    return { ok: false, reason: 'not_found', matches: [] };
  }
  if (matches.length > 1) {
    return { ok: false, reason: 'ambiguous', matches };
  }
  return { ok: true, resolved: matches[0]! };
}

/** Parse "aqiqah" / "basmalah" sebagai Business, atau return null. */
export function parseBusiness(s: string): Business | null {
  const lower = s.toLowerCase();
  if (lower === 'aqiqah') return 'aqiqah';
  if (lower === 'basmalah') return 'basmalah';
  return null;
}

/** Parse branch token (case-insensitive). Returns Branch atau null. */
export function parseBranch(s: string): Branch | null {
  const upper = s.toUpperCase();
  if (upper === 'PUSAT' || upper === 'JABAR' || upper === 'JATIM' || upper === 'JOGJA') {
    return upper;
  }
  return null;
}
