/**
 * Cross-module domain types yang dipakai > 1 modul. Modul tidak boleh
 * tarik-menarik type ini langsung satu sama lain — taruh di sini supaya
 * dependency direction selalu ke atas (modul → 00-foundation).
 *
 * Kalau type ini berubah (mis. tambah brand baru), check semua usage
 * dengan `grep -r "Brand" src/modules`.
 */

/**
 * Brand bisnis yang dilayani sistem. Match dengan
 * `meta_connections.account_name` via `detectBrand` heuristic
 * (case-insensitive substring "basmalah" → 'basmalah', selain itu
 * 'aqiqah'). Lihat `14-meta-progress/benchmarks.ts` untuk fungsi
 * `detectBrand`.
 */
export type Brand = 'basmalah' | 'aqiqah';

/**
 * Channel kategori kampanye — drives benchmark threshold ✅/⚠️ di
 * `14-meta-progress/buildProgressBubbles`.
 */
export type Channel =
  | 'leads_wa' // Messages/Leads to WhatsApp (CPR)
  | 'leads_lp' // Leads to landing page (CPR)
  | 'traffic_lp' // Traffic to landing page (CPC)
  | 'traffic_wa' // Traffic to WhatsApp (CPR — pseudo)
  | 'awareness' // Awareness (CPM)
  | 'sales'; // Conversion / Purchase campaigns
