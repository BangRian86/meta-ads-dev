/**
 * Cron entry point: 00:00 UTC = 07:00 WIB.
 * Versi Sheets-based — replace cron lama (`/etc/cron.d/maa-roas-alerts`)
 * yang sekarang sudah disabled.
 *
 * Behavior:
 *   - Evaluasi semua threshold di tab ALERT_CONFIG terhadap data hari ini
 *     dari *-REPORTING tabs (Aqiqah PUSAT/JABAR/JATIM/JOGJA + Basmalah PUSAT).
 *   - Kalau semua healthy → exit silent (no Telegram traffic).
 *   - Kalau ada critical / warning → kirim ke group.
 */
import { Telegraf } from 'telegraf';
import { closeDb } from '../src/modules/00-foundation/index.js';
import { appConfig as config } from '../src/modules/00-foundation/index.js';
import { logger } from '../src/modules/00-foundation/index.js';
import { evaluateAlertsForCron } from '../src/modules/30-sheets-reader/index.js';

async function main(): Promise<number> {
  if (!config.telegram.botToken) {
    logger.error('No TELEGRAM_BOT_TOKEN — cannot send sheets alerts');
    return 2;
  }
  const groupId = config.telegram.groupChatId;
  if (!groupId) {
    logger.error('No TELEGRAM_GROUP_CHAT_ID — cannot send sheets alerts');
    return 2;
  }

  let messageText: string | null = null;
  try {
    messageText = await evaluateAlertsForCron();
    logger.info(
      { silent: messageText === null, chars: messageText?.length ?? 0 },
      'sheets-alerts: evaluation done',
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.error({ err }, 'sheets-alerts: evaluation crashed');
    // Pipeline crash → SEND error ke group. Better noisy than silent fail.
    messageText = `❌ Sheets alert pipeline crash.\nError: ${reason}`;
  }

  if (messageText === null) {
    logger.info('sheets-alerts: silent (semua healthy)');
    return 0;
  }

  const sender = new Telegraf(config.telegram.botToken);
  // Telegram limit ~4096 chars; alert biasanya jauh lebih kecil tapi
  // safety split kalau threshold banyak.
  const MAX = 3800;
  const chunks: string[] = [];
  let buf = '';
  for (const line of messageText.split('\n')) {
    const next = buf ? `${buf}\n${line}` : line;
    if (next.length > MAX && buf) {
      chunks.push(buf);
      buf = line;
    } else {
      buf = next;
    }
  }
  if (buf) chunks.push(buf);

  try {
    for (const c of chunks) {
      await sender.telegram.sendMessage(groupId, c, {
        link_preview_options: { is_disabled: true },
      });
    }
    logger.info(
      { groupId, chunks: chunks.length },
      'sheets-alerts: sent',
    );
    return 0;
  } catch (err) {
    logger.error({ err, groupId }, 'sheets-alerts: failed to send');
    return 3;
  }
}

let exitCode = 0;
try {
  exitCode = await main();
} catch (err) {
  logger.fatal({ err }, 'sheets-alerts: unexpected crash');
  exitCode = 1;
} finally {
  await closeDb();
}
process.exit(exitCode);
