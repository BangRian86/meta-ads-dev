import { Telegraf } from 'telegraf';
import { appConfig as config } from '../src/modules/00-foundation/index.js';
import { logger } from '../src/modules/00-foundation/index.js';
import {
  buildDailyReport,
  getYesterdayReport,
  type DailyReportRoasRow,
} from '../src/modules/13-sheets-integration/index.js';
import { buildRoasReport } from '../src/modules/15-closing-tracker/index.js';

/**
 * Cron entry point: runs the Google Sheets daily report and posts to the
 * Telegram group. The bot's main process is polling-only, so we instantiate
 * a sender-only Telegraf here for one-shot sendMessage. It does NOT call
 * .launch() so it never conflicts with the polling lock.
 */
async function main(): Promise<number> {
  if (!config.telegram.botToken) {
    logger.error('No TELEGRAM_BOT_TOKEN — cannot send daily sheets report');
    return 2;
  }
  const groupId = config.telegram.groupChatId;
  if (!groupId) {
    logger.error('No TELEGRAM_GROUP_CHAT_ID — cannot send daily sheets report');
    return 2;
  }

  const sender = new Telegraf(config.telegram.botToken);

  let messageText: string;
  try {
    const report = await getYesterdayReport();
    // Best-effort ROAS attachment — if the closing tracker / Meta insight
    // call fails, we still send the sheets report.
    let roasRows: DailyReportRoasRow[] = [];
    try {
      const roas = await buildRoasReport(1, 1);
      roasRows = roas.perAccount.map((a) => ({
        label: a.accountName,
        spendIdr: a.spendIdr,
        revenueIdr: a.revenueIdr,
        closingQuantity: a.closingQuantity,
        unit: a.unit,
        roas: a.roas,
      }));
    } catch (err) {
      logger.warn({ err }, 'sheets-integration: ROAS attachment failed');
    }
    messageText = buildDailyReport(report, { roas: roasRows });
    logger.info(
      {
        targetDate: report.targetDate,
        errorCount: report.errors.length,
        roasRows: roasRows.length,
      },
      'sheets-integration: report built',
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.error({ err }, 'sheets-integration: report build crashed');
    messageText = `❌ Laporan harian Google Sheets gagal dibuat.\nError: ${reason}`;
  }

  try {
    await sender.telegram.sendMessage(groupId, messageText, {
      link_preview_options: { is_disabled: true },
    });
    logger.info({ groupId }, 'sheets-integration: report sent');
    return 0;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.error({ err, groupId }, 'sheets-integration: failed to send report');
    return 3;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    logger.error({ err }, 'sheets-integration: unexpected crash');
    process.exit(1);
  });
