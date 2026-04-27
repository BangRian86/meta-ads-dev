import { Telegraf } from 'telegraf';
import { closeDb } from '../src/db/index.js';
import { config } from '../src/config/env.js';
import { logger } from '../src/lib/logger.js';
import {
  evaluateAlerts,
  formatMultipleResults,
} from '../src/modules/20-roas-alert/index.js';

/**
 * Cron entry point — runs daily at 00:00 UTC (07:00 WIB).
 * Evaluates ROAS alerts for both businesses on the daily window. If any
 * critical/warning alert fires, posts to the Telegram group. If everything
 * is healthy, exits silently with no Telegram traffic (no spam).
 */
async function main(): Promise<number> {
  if (!config.telegram.botToken) {
    logger.error('No TELEGRAM_BOT_TOKEN — cannot send ROAS alerts');
    return 2;
  }
  const groupId = config.telegram.groupChatId;
  if (!groupId) {
    logger.error('No TELEGRAM_GROUP_CHAT_ID — cannot send ROAS alerts');
    return 2;
  }

  let messageText: string | null = null;
  let totalAlerts = 0;
  try {
    const [basmalah, aqiqah] = await Promise.all([
      evaluateAlerts('basmalah', 'daily'),
      evaluateAlerts('aqiqah', 'daily'),
    ]);
    totalAlerts = basmalah.alerts.length + aqiqah.alerts.length;
    // includeHealthyMessage=false ⇒ formatMultipleResults returns null
    // when both businesses are clean, which we treat as "nothing to send".
    messageText = formatMultipleResults([basmalah, aqiqah]);
    logger.info(
      {
        basmalahAlerts: basmalah.alerts.length,
        aqiqahAlerts: aqiqah.alerts.length,
      },
      'roas-alerts: evaluation done',
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.error({ err }, 'roas-alerts: evaluation crashed');
    // On crash we DO send to the group — silent failure of an alert
    // pipeline is worse than the "you have alerts" pipeline.
    messageText = `❌ ROAS alert pipeline gagal.\nError: ${reason}`;
  }

  if (messageText === null) {
    logger.info('roas-alerts: no alerts; staying silent');
    return 0;
  }

  const sender = new Telegraf(config.telegram.botToken);
  try {
    await sender.telegram.sendMessage(groupId, messageText, {
      link_preview_options: { is_disabled: true },
    });
    logger.info({ groupId, totalAlerts }, 'roas-alerts: sent');
    return 0;
  } catch (err) {
    logger.error({ err, groupId }, 'roas-alerts: failed to send');
    return 3;
  }
}

let exitCode = 0;
try {
  exitCode = await main();
} catch (err) {
  logger.fatal({ err }, 'roas-alerts: unexpected crash');
  exitCode = 1;
} finally {
  await closeDb();
}
process.exit(exitCode);
