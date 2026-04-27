/**
 * Per-brand benchmark thresholds for the 3x-daily progress report.
 * Numbers are IDR (Rupiah) and come from the operator's playbook.
 *
 * "cheap" → ✅ emoji
 * "expensive" → ⚠️ emoji
 * in between → no emoji
 */

export type Brand = 'basmalah' | 'aqiqah';
export type Channel =
  | 'leads_wa' // Messages/Leads to WhatsApp (CPR)
  | 'leads_lp' // Leads to landing page (CPR)
  | 'traffic_lp' // Traffic to landing page (CPC)
  | 'traffic_wa' // Traffic to WhatsApp (CPR — pseudo)
  | 'awareness' // Awareness (CPM)
  | 'sales'; // Conversion / Purchase campaigns (CPR — high-value, high-tier threshold)

export interface Benchmark {
  /** Cap below which the campaign is considered cheap. */
  cheap: number;
  /** Cap above which the campaign is considered expensive. */
  expensive: number;
}

const BENCHMARKS: Record<Brand, Record<Channel, Benchmark>> = {
  basmalah: {
    leads_wa: { cheap: 10_000, expensive: 30_000 },
    leads_lp: { cheap: 25_000, expensive: 50_000 },
    traffic_lp: { cheap: 300, expensive: 1_500 },
    traffic_wa: { cheap: 10_000, expensive: 30_000 },
    awareness: { cheap: 10_000, expensive: 25_000 },
    // Sales/Purchase campaigns punya tier threshold lebih tinggi karena
    // event-nya transaksi (high-intent, lebih mahal per event tapi lebih
    // bernilai). Operator playbook: Basmalah <100k murah, >300k mahal.
    sales: { cheap: 100_000, expensive: 300_000 },
  },
  aqiqah: {
    leads_wa: { cheap: 10_000, expensive: 30_000 },
    leads_lp: { cheap: 20_000, expensive: 45_000 },
    traffic_lp: { cheap: 300, expensive: 1_500 },
    traffic_wa: { cheap: 10_000, expensive: 30_000 },
    awareness: { cheap: 10_000, expensive: 25_000 },
    // Aqiqah ticket lebih kecil dari Basmalah → cap mahal di 250k
    // (vs Basmalah 300k).
    sales: { cheap: 100_000, expensive: 250_000 },
  },
};

export function lookupBenchmark(brand: Brand, channel: Channel): Benchmark {
  return BENCHMARKS[brand][channel];
}

export function statusEmoji(value: number, b: Benchmark): '✅' | '⚠️' | '' {
  if (value <= 0) return '';
  if (value < b.cheap) return '✅';
  if (value > b.expensive) return '⚠️';
  return '';
}

/** Identifies brand from a connection.accountName. Heuristic but stable
 *  enough — the only Basmalah brand starts with that name. */
export function detectBrand(accountName: string): Brand {
  return /basmalah/i.test(accountName) ? 'basmalah' : 'aqiqah';
}
