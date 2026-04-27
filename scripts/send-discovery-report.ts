/**
 * Tahap 1 — kirim Discovery Report ke Telegram group, lalu STOP.
 * Konten report sudah disusun manual berdasarkan output:
 *   - scripts/discover-sheets.ts
 *   - scripts/discover-reporting-wide.ts
 * (read-only, no production code touched).
 */
import { Telegraf } from 'telegraf';
import { config } from '../src/config/env.js';
import { logger } from '../src/lib/logger.js';
import { closeDb } from '../src/db/index.js';

function todayWib(): string {
  // Format singkat WIB buat header report.
  const utc = new Date();
  const wibMs = utc.getTime() + 7 * 60 * 60 * 1000;
  const wib = new Date(wibMs);
  return (
    wib.toISOString().slice(0, 10) +
    ' ' +
    wib.toISOString().slice(11, 16) +
    ' WIB'
  );
}

const REPORT = `🔍 SHEETS DISCOVERY REPORT (Tahap 1)
Generated: ${todayWib()}

📁 SPREADSHEETS DETECTED: 2

1. Monitoring Basmalah Trevel 2026
   id: 1z6hCUAvzoTHwcmI9Sg3bN2VmEIhPw6cvCTGZYhBHIwE
   11 tabs

2. Monitoring 2026 (Express Nasional)
   id: 1KES1HBKuR7fXgfYV7c5b2tYcsazahcu08gH_Aibdh7c
   19 tabs

⚠️ Catatan akses: Drive API belum di-enable di GCP project, jadi service
account cuma bisa "lihat" 2 spreadsheet yang sudah pernah Bang Rian share
secara eksplisit. Kalau ada spreadsheet lain yang harusnya ke-discover,
perlu enable Drive API dulu di GCP console.

────────────────────────────────────────

📊 STRUKTUR — Aqiqah (Monitoring 2026 Express Nasional)

CS Performance (5 tabs):
 • CS DB        — agregat per-CS lifetime (Chat, Closing, Ekoran, Revenue,
                  Spending Budget, CAC, SAC, Average ROAS)
 • CS PUSAT     — daily input chat per CS Pusat per dapur (Ciputat,
                  Tangerang, Bekasi, Bogor, Cilegon, Jonggol)
 • CS JABAR     — idem untuk Jabar (Bandung, Cimahi, Garut, Kuningan,
                  Sumedang, Cirebon, Jateng Barat)
 • CS JATIM     — idem (Surabaya, Sidoarjo, Kediri, Malang, Madiun)
 • CS JOGJA     — idem (Jogja, Kulon Progo, Sleman, Bantul, GK, Semarang)

Channel Reporting (4 tabs):
 • PUSAT - REPORTING
 • JABAR - REPORTING
 • JATIM - REPORTING
 • JOGJA - REPORTING

Aggregator/derived (5 tabs):
 • VALIDASI, DNM, DNC, ISI FORM, FORM_TFOOD, CS PERFORM,
   1. CHAT, 2. CLOSING, 3. EKOR, 4. REVENUE
   (sebagian besar formula-driven, agregat dari CS PUSAT/JABAR/JATIM/JOGJA)

────────────────────────────────────────

📊 STRUKTUR — Basmalah (Monitoring Basmalah Trevel 2026)

CS Performance (1 tab CS aktif):
 • CS PUSAT (Putri, Amel, dll)
 • CS DB   — agregat Basmalah-only

Channel Reporting (1 tab):
 • PUSAT - REPORTING (Basmalah cuma Pusat — belum ada cabang lain)

Helper tabs: NB, DNM, DNC, 1. CHAT, 2. CLOSING, 3. KEBERANGKATAN,
             4. REVENUE, CS PERFORM

────────────────────────────────────────

🔑 KOLOM KUNCI di tab "*-REPORTING" (sama untuk Basmalah & Aqiqah,
   8 tab total: 1 Basmalah PUSAT + 4 Aqiqah cabang × 2 = same layout)

Layout: Tgl di kolom A, baris-1 = header, data mulai baris 3.

   A  Tgl
   B  ATC IKLAN (Meta)        F  REAL CHAT MASUK (Meta)
   C  Google Ads              G  Google
   D  Tiktok Ads              H  Tiktok
   E  Total ATC Iklan         I  Total Chat

   J  CLOSINGAN (Meta)        N  Total Ekoran (Aqiqah) /
   K  Closing Google             Total Keberangkatan (Basmalah)
   L  Closing Tiktok          O  Revenue Berjalan
   M  Total Closing

   P  Biaya Marketing (Meta)
   Q  11% Pajak Meta Ads
   R  Biaya Google Ads
   S  11% Pajak Google Ads
   T  Biaya Tiktok Ads
   U  11% Pajak Tiktok Ads
   V  Total Biaya Iklan        ← total semua channel + pajak

   W  PERSENTASE (%)           ← =F/B (chat ÷ ATC, conversion ratio)
   X  CR % (Meta)              Y  ATC to WA (Google)
   Z  CR % (Google)            AA ATC to WA (Tiktok)
   AB CR % (Tiktok)            AC ATC to WA (ALL)
   AD CR % (ALL)

   AE COST PER CONVERSATION
   AF CPR DB IKLAN (Google)    AG CPR DB IKLAN (Tiktok)
   AH CPR Real WA (Meta)       AI CPR Real WA (Google)
   AJ CPR Real WA (Tiktok)
   AK WAC                      AL CAC                AM SAC
   AN ROAS  ← ★ ROAS sudah dihitung di Sheet (= O ÷ V kira-kira)

Sample real (Aqiqah PUSAT, 1 Apr 2026):
   Total Closing 42 | Ekor 60 | Revenue Rp 165.777.450
   Total Biaya Iklan Rp 4.630.546 | ROAS 35,80x

────────────────────────────────────────

🔑 KOLOM KUNCI di tab "CS DB" (per-CS lifetime aggregate)

   B  CS (nama)        G  Revenue Berjalan
   C  Chat             H  Spending Budget
   D  Closing          I  Average CAC
   E  Ekoran           J  Average SAC
   F  Closing Rate     K  Average ROAS  ← ★ per-CS ROAS

Sample (Aqiqah PUSAT):
   Dinda  : 945 chat, 110 closing, 165 ekor, CR 11,64%, Rev Rp 457jt
   Nabila : 831 chat, 109 closing, 159 ekor, CR 13,12%, Rev Rp 446jt

⚠️ "CS DB" cuma agregat lifetime — TIDAK ada filter tanggal di header.
    Buat per-periode (daily/weekly/monthly), pakai tab "CS PERFORM"
    yang punya kolom Tanggal + breakdown harian per CS.

────────────────────────────────────────

🔑 TAB "CS PERFORM" (per-CS daily breakdown)

Layout (header row 1, data dari row 2):
   A Tanggal | B Head/Provinsi | C Customer Service
   D Chat | E Closing | F Ekor/Keberangkatan | G Revenue Berjalan
   H Biaya Per CS | I CAC | J SAC

Inilah tab yang dipakai buat /cs putri 7d / /cs fikri 30d, dst.

────────────────────────────────────────

🎯 PEMETAAN COMMAND → TAB

Use case             Sumber data              Catatan
──────────────────   ──────────────────────   ─────────────────────────
/cs [nama]           CS PERFORM (filter A=    Per-CS dengan range tanggal
                     tanggal + C=nama)
/cabang [nama]       *-REPORTING (sum row     Agregat cabang per range
                     by Tgl di kolom A)
/roas [cabang]       *-REPORTING kolom AN     ★ Baca apa adanya, NO
                                              recalc. Single-day = baris
                                              tanggal itu; range = avg.
/tiktok [cabang]     *-REPORTING kolom        TikTok-specific: D, H, L,
                     D, H, L, T, AA, AB,      T, AG, AJ, AA
                     AG, AJ
/alert               Sekumpulan kolom dari    Threshold ke depannya
                     CS DB & *-REPORTING      bisa ditaruh di tab khusus
                                              di Sheet supaya editable
                                              tanpa redeploy

────────────────────────────────────────

⚠️ AMBIGUITIES — minta konfirmasi Bang Rian

1. ROAS aggregation
   Untuk range (mis. 7d): apakah /roas hitung
   (a) average dari kolom AN, atau
   (b) SUM(O) ÷ SUM(V) untuk range itu (recompute dari source)?
   Spec bilang "tidak hitung ulang", jadi default = (a) average kolom AN.
   Konfirmasi: oke pakai average?

2. Basmalah PUSAT-REPORTING isinya kebanyakan "-"
   Sample 1-Apr & 2-Apr: Total Closing/Ekor/Revenue/ROAS semua "-".
   Apakah:
   (a) memang belum ada closing untuk Basmalah di periode awal?
   (b) data belum ke-input?
   (c) formula belum aktif?
   Konfirmasi sebelum bikin /roas yang mungkin sering balik kosong
   buat Basmalah.

3. Threshold storage
   Mau threshold alert disimpan di tab khusus di Sheet (gampang
   di-edit Bang Rian sendiri tanpa redeploy)?
   Atau hardcode dulu di config code, nanti commands buat update?

4. Periode "default"
   /cs putri tanpa range = "today only" atau "this month"?
   /roas pusat tanpa range = "today" atau "7 hari terakhir"?
   Spec contoh /cs putri = "today", tapi today untuk Basmalah sering
   kosong. Konfirmasi default-nya.

5. CS yang belum ke-list
   "CS PUSAT" Basmalah cuma 2 nama (Putri, Amel) dari sample.
   "CS PUSAT" Aqiqah ada Dinda, Nabila, Mega, Adinda, dll.
   Bot bakal ambil DAFTAR CS dinamis dari tab CS DB tiap call,
   atau hardcode list? Saran: dinamis (selalu fresh).

6. Aliasing nama
   /cs putri ⇒ "Putri" exact match? Case-insensitive substring?
   "Putri" muncul di Basmalah & "Putri" mungkin nggak ada di Aqiqah.
   Kalau ambigu (misal Putri ada di 2 spreadsheet), gimana?
   Saran: search di SEMUA CS DB, kalau >1 match minta clarify
   ("Putri (Basmalah) atau Putri (Aqiqah PUSAT)?").

7. /alert cron
   Cron lama (07:00 WIB ROAS alert pakai Meta API) — mau di-keep dulu
   atau langsung di-disable dan diganti dengan versi Sheet-based?
   Saran: keep dulu sampai versi baru tested (transition window).

────────────────────────────────────────

➡️ NEXT STEP

Tunggu konfirmasi Bang Rian:
 • Pemahaman struktur Sheet sudah benar? (atau ada koreksi)
 • Jawab 7 ambiguity di atas (terutama #1 ROAS aggregation, #2 Basmalah,
   #4 default periode)
 • OK lanjut ke Tahap 2 build commands?

Setelah dijawab, saya akan:
 1. Bangun module 13-sheets-integration baru atau extend yang ada
 2. Bikin 5 commands /cs /cabang /roas /tiktok /alert
 3. Reuse parseDateRange + formatter humanis yang sudah ada
 4. Test → restart → konfirmasi siap dipakai

Status: ⏸ STOP — menunggu konfirmasi.`;

async function main(): Promise<number> {
  if (!config.telegram.botToken) {
    logger.error('No TELEGRAM_BOT_TOKEN — cannot send report');
    return 2;
  }
  const groupId = config.telegram.groupChatId;
  if (!groupId) {
    logger.error('No TELEGRAM_GROUP_CHAT_ID — cannot send report');
    return 2;
  }

  const sender = new Telegraf(config.telegram.botToken);

  // Telegram message limit ~4096 chars; report sengaja >4k jadi split.
  const MAX = 3800;
  const chunks: string[] = [];
  let buf = '';
  for (const block of REPORT.split('\n\n')) {
    const candidate = buf ? `${buf}\n\n${block}` : block;
    if (candidate.length > MAX && buf) {
      chunks.push(buf);
      buf = block;
    } else {
      buf = candidate;
    }
  }
  if (buf) chunks.push(buf);

  console.log(`Report total ${REPORT.length} chars → ${chunks.length} chunks`);
  console.log('\nFull report (also being sent to Telegram):\n');
  console.log(REPORT);
  console.log('\n────────── sending… ──────────');

  for (let i = 0; i < chunks.length; i += 1) {
    const prefix =
      chunks.length > 1 && i > 0 ? `(lanjutan ${i + 1}/${chunks.length})\n\n` : '';
    try {
      await sender.telegram.sendMessage(groupId, prefix + chunks[i], {
        link_preview_options: { is_disabled: true },
      });
      logger.info({ groupId, chunk: i + 1 }, 'discovery: chunk sent');
    } catch (err) {
      logger.error({ err, chunk: i + 1 }, 'discovery: send failed');
      return 3;
    }
  }
  console.log('✅ Report sent to Telegram. Awaiting Bang Rian confirmation.');
  return 0;
}

let exitCode = 0;
try {
  exitCode = await main();
} catch (err) {
  logger.fatal({ err }, 'discovery sender crashed');
  exitCode = 1;
} finally {
  await closeDb();
}
process.exit(exitCode);
