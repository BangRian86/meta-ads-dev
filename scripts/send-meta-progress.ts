import { Telegraf } from 'telegraf';
import { config } from '../src/config/env.js';
import { logger } from '../src/lib/logger.js';
import {
  buildProgressBubbles,
  buildProgressData,
  wibHourLabel,
} from '../src/modules/14-meta-progress/index.js';

/**
 * Cron entry point for the 3x-daily Meta Ads progress report (04/09/14 UTC).
 * The bot's main process owns the polling lock, so we instantiate a
 * sender-only Telegraf here that never calls .launch().
 *
 * Multi-bubble layout: one header summary message, then one message per
 * account. If an individual bubble exceeds 4096 chars (Telegram cap), it is
 * split at paragraph boundaries with "(lanjutan…)" prefix on continuation
 * messages.
 *
 * Argv: optional "--utc-hour=NN" to override the WIB header label, otherwise
 * we derive it from the current wall-clock UTC hour (correct for cron-fired
 * runs and reasonable for ad-hoc manual runs).
 */
const MAX = 4000;

function chunk(text: string): string[] {
  if (text.length <= MAX) return [text];
  const blocks = text.split('\n\n');
  const out: string[] = [];
  let buf = '';
  for (const b of blocks) {
    const next = buf ? `${buf}\n\n${b}` : b;
    if (next.length > MAX && buf) {
      out.push(buf);
      buf = b.length > MAX ? b.slice(0, MAX - 1) + '…' : b;
    } else {
      buf = next.length > MAX ? next.slice(0, MAX - 1) + '…' : next;
    }
  }
  if (buf) out.push(buf);
  return out;
}

async function sendBubble(
  sender: Telegraf,
  chatId: string,
  text: string,
): Promise<void> {
  const chunks = chunk(text);
  for (let i = 0; i < chunks.length; i++) {
    const prefix = i === 0 ? '' : '(lanjutan…)\n\n';
    await sender.telegram.sendMessage(chatId, prefix + chunks[i], {
      link_preview_options: { is_disabled: true },
    });
  }
}

async function main(): Promise<number> {
  if (!config.telegram.botToken) {
    logger.error('No TELEGRAM_BOT_TOKEN — cannot send progress report');
    return 2;
  }
  const groupId = config.telegram.groupChatId;
  if (!groupId) {
    logger.error('No TELEGRAM_GROUP_CHAT_ID — cannot send progress report');
    return 2;
  }

  const utcHourArg = process.argv
    .find((a) => a.startsWith('--utc-hour='))
    ?.slice('--utc-hour='.length);
  const utcHour = utcHourArg != null ? Number(utcHourArg) : new Date().getUTCHours();
  const hourLabel = wibHourLabel(utcHour);

  const sender = new Telegraf(config.telegram.botToken);

  let bubbles;
  try {
    const data = await buildProgressData();
    bubbles = buildProgressBubbles(data, hourLabel);
    logger.info(
      {
        date: data.date,
        accounts: data.accounts.length,
        totalSpend: data.totalSpend,
        errors: data.errors.length,
      },
      'meta-progress: bubbles built',
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.error({ err }, 'meta-progress: bubbles build crashed');
    try {
      await sender.telegram.sendMessage(
        groupId,
        `❌ Laporan progress iklan ${hourLabel} gagal dibuat.\nError: ${reason}`,
        { link_preview_options: { is_disabled: true } },
      );
    } catch (sendErr) {
      logger.error({ err: sendErr, groupId }, 'meta-progress: failed to send error notice');
    }
    return 3;
  }

  // Header first, then one message per account. Failure on a single bubble
  // is logged but does not block the others.
  let sentOk = 0;
  let sentFail = 0;
  const all = [bubbles.header, ...bubbles.perAccount];
  for (let i = 0; i < all.length; i++) {
    try {
      await sendBubble(sender, groupId, all[i]!);
      sentOk += 1;
    } catch (err) {
      sentFail += 1;
      const reason = err instanceof Error ? err.message : String(err);
      logger.error(
        { err, groupId, bubbleIndex: i },
        'meta-progress: failed to send bubble',
      );
      logger.warn({ reason }, 'meta-progress: continuing with remaining bubbles');
    }
  }
  logger.info(
    { groupId, bubblesOk: sentOk, bubblesFail: sentFail },
    'meta-progress: report sent',
  );
  return sentFail === 0 ? 0 : 4;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    logger.error({ err }, 'meta-progress: unexpected crash');
    process.exit(1);
  });
