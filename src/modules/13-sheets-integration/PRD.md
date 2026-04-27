# PRD — 13-sheets-integration

## Problem yang Diselesaikan

Tim sales/closing input data harian (jumlah leads, chat, closing,
revenue) ke Google Sheets — bukan ke Meta. Data ini lebih akurat untuk
ROAS / cost per closing daripada attribution Meta. Modul ini menjadi
satu-satunya pintu read ke spreadsheet bisnis sehingga modul lain
(daily report, ROAS alert, anomaly, optimizer) bisa konsumsi tanpa
duplicate logic auth + parser.

## Fitur Tersedia

- **Read 5 tab spreadsheet** — Basmalah Travel + Aqiqah cabang
  (Pusat, Jatim, Jabar, Jogja).
- **Parse layout konsisten** — column A date, M closing, N
  jamaah/ekor, O revenue.
- **Indonesian date parsing** — "2 Apr", "5 Mei", "12 Des".
- **Daily report** — agregasi per section + total.
- **Closing-revenue per range** — dipakai modul ROAS alert dan
  optimizer untuk hitung cost per closing.
- **Per-account match** — `matchSheetSourceForAccount(connection)` map
  Meta ad account ke sheet source (by account name pattern).
- **Per-section error tolerance** — 1 tab gagal tidak block tab lain.

## Non-goals

- **Tidak menulis** ke Sheets — read-only scope.
- **Tidak generic Sheets reader** — hardcoded layout 5 tab tertentu.
  Tab baru → update `SHEET_SOURCES`.
- **Tidak menyimpan cache** — setiap call hit Google Sheets API.
  Caller yang cache kalau perlu.
- **Tidak handle pagination** — assume data ≤ ~365 rows per tab
  (1 tahun harian).
- **Tidak parse tahun di kolom date** — asumsi current year (UTC).
  Sheet rolling tahunan harus di-rename / di-archive manual.

## Success Metrics

- **Latency p95 < 4 detik** untuk daily report (5 tab paralel).
- **Section error tolerance** — kalau 1 tab gagal, 4 lain render
  ≥ 95% dari run.
- **Date parser accuracy** — 100% tanggal valid (1 Jan – 31 Des) ter-parse
  ke YYYY-MM-DD; row dengan tanggal kosong → `dateIso=null` (skip).
- **Numeric coercion robust** — kolom dengan koma / Rp prefix tetap
  ter-parse jadi number (tidak NaN).
- **Auth health** — kalau service account credential expired / sheet
  un-shared, error pesan jelas (tidak cryptic).
