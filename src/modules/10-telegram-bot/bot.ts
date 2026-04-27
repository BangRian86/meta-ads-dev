import { Telegraf } from 'telegraf';
import { config } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { registerCommands } from './commands.js';
import { groupFilter } from './group-filter.js';

let runningBot: Telegraf | null = null;

export async function startBot(): Promise<Telegraf | null> {
  if (!config.telegram.isConfigured) {
    logger.info('Telegram bot skipped (TELEGRAM_BOT_TOKEN/CHAT_ID not set)');
    return null;
  }
  if (runningBot) return runningBot;

  const bot = new Telegraf(config.telegram.botToken!);
  // Group privacy filter HARUS dipasang sebelum registerCommands —
  // Telegraf middleware urutan-sensitif. Filter ini drop pesan obrolan
  // biasa di group; DM lewat tanpa filter.
  bot.use(groupFilter());
  registerCommands(bot);

  bot.catch((err, ctx) => {
    logger.error({ err, update: ctx.update }, 'Telegraf handler crashed');
  });

  // launch() resolves only on shutdown; fire-and-forget to keep the main
  // process from blocking. Errors during the launch handshake propagate via
  // the returned promise's rejection — log them.
  bot
    .launch({ dropPendingUpdates: true })
    .catch((err) => logger.error({ err }, 'Telegram bot launch failed'));

  runningBot = bot;
  logger.info('Telegram bot launched');
  return bot;
}

export async function stopBot(reason: string): Promise<void> {
  if (!runningBot) return;
  try {
    runningBot.stop(reason);
  } catch (err) {
    logger.warn({ err }, 'Error stopping Telegram bot');
  }
  runningBot = null;
}

export function getRunningBot(): Telegraf | null {
  return runningBot;
}
