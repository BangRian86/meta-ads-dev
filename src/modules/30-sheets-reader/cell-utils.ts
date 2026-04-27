/**
 * Helper untuk parse cell Sheets.
 *
 * Sheets API kalau pakai UNFORMATTED_VALUE return number atau "" kosong,
 * tapi kalau formula evaluate ke "-" string-nya literal "-". Bedakan:
 *   - "no-data" = "-", "—", "N/A", "", null, undefined → BELUM ADA DATA
 *   - 0 = ZERO DATA (legitimate, e.g. campaign spend Rp 0 hari ini)
 *
 * /cs dan /cabang yang dapat NO_DATA harus tampilkan "Belum tercatat",
 * bukan "Rp 0".
 */

export const NO_DATA = Symbol('NO_DATA');
export type NoData = typeof NO_DATA;

/** Parse a cell ke number, atau NO_DATA kalau "kosong". */
export function parseCellNumber(cell: unknown): number | NoData {
  if (cell == null) return NO_DATA;
  if (typeof cell === 'number') return Number.isFinite(cell) ? cell : NO_DATA;
  if (typeof cell !== 'string') return NO_DATA;
  const trimmed = cell.trim();
  if (
    trimmed === '' ||
    trimmed === '-' ||
    trimmed === '—' ||
    trimmed === 'N/A' ||
    trimmed.toLowerCase() === 'n/a' ||
    trimmed === '#N/A' ||
    trimmed === '#VALUE!' ||
    trimmed === '#DIV/0!'
  ) {
    return NO_DATA;
  }
  // Sheets sometimes returns "1.234.567" (titik thousand sep) atau
  // "1,234,567" (kalau locale beda) atau "85,40%". Strip non-numeric kecuali . - ,
  const cleaned = trimmed
    .replace(/Rp\s?/i, '')
    .replace(/%$/, '')
    .replace(/[^\d.\-,]/g, '');
  if (!cleaned) return NO_DATA;
  // Heuristik: kalau ada >1 titik, semua titik = thousand separator.
  // Kalau cuma 1 titik, treat sebagai decimal kalau diikuti ≤2 digit, else
  // thousand separator.
  let normalized: string;
  const dotCount = (cleaned.match(/\./g) ?? []).length;
  const commaCount = (cleaned.match(/,/g) ?? []).length;
  if (dotCount > 1) {
    normalized = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (commaCount > 1) {
    normalized = cleaned.replace(/,/g, '');
  } else if (commaCount === 1 && dotCount === 0) {
    // Format Indonesia: "85,40" = 85.40
    normalized = cleaned.replace(',', '.');
  } else {
    normalized = cleaned;
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : NO_DATA;
}

/** Parse cell jadi string trimmed, atau "" kalau kosong/null. */
export function parseCellString(cell: unknown): string {
  if (cell == null) return '';
  return String(cell).trim();
}

/** Apakah value adalah NO_DATA sentinel? */
export function isNoData(v: number | NoData): v is NoData {
  return v === NO_DATA;
}

// ---------- Date helpers ----------

/**
 * Sheets serial number → ISO date (YYYY-MM-DD). Sheets epoch = 1899-12-30.
 * Kita treat angka sebagai "calendar day in WIB" — Bang Rian input tanggal
 * dalam konteks lokal, jadi jangan apply UTC offset.
 */
export function sheetsSerialToIsoDate(serial: number): string {
  // 86_400_000 ms per day; 25_569 = days dari 1899-12-30 ke 1970-01-01.
  const ms = (serial - 25_569) * 86_400_000;
  const d = new Date(ms);
  // Pakai UTC getter karena ms udah anchor di UTC midnight.
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** "Today" dalam zona WIB (UTC+7) sebagai YYYY-MM-DD. Spread sheet input
 *  pakai konteks WIB, jadi default "today" harus WIB-aware. */
export function wibIsoDate(daysOffset = 0): string {
  const wibMs = Date.now() + 7 * 60 * 60 * 1000 + daysOffset * 86_400_000;
  const d = new Date(wibMs);
  return d.toISOString().slice(0, 10);
}

/** Konversi WIB ISO date ke Sheets serial number (untuk filter range). */
export function isoDateToSheetsSerial(iso: string): number {
  const d = new Date(`${iso}T00:00:00Z`);
  const days = d.getTime() / 86_400_000;
  return days + 25_569;
}
