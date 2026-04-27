import { Telegraf } from 'telegraf';
import { config } from '../../config/env.js';
import { logger } from '../../lib/logger.js';

let standaloneBot: Telegraf | null = null;

/** Lazily creates a sender-only Telegraf for outbound messages from non-bot
 *  contexts (e.g. the auto-optimizer running on a cron). The actual command
 *  bot uses its own Telegraf instance via `bot.ts`. */
function senderBot(): Telegraf | null {
  if (!config.telegram.isConfigured) return null;
  if (!standaloneBot) {
    standaloneBot = new Telegraf(config.telegram.botToken!);
  }
  return standaloneBot;
}

export interface NotifyOptions {
  /** Optional explicit parse mode. Default is plain text (no parsing) so
   *  arbitrary content — including ad copy with underscores, asterisks, or
   *  punctuation — never trips Telegram's entity parser. */
  parseMode?: 'Markdown' | 'HTML' | undefined;
  disableNotification?: boolean;
}

/**
 * Sends an automatic notification (optimizer, hourly summary, scheduled
 * reports) to the group chat only. Owner DM is intentionally excluded — the
 * owner reads these via group membership. The returned status reflects
 * whether the group delivery succeeded.
 */
export async function notifyOwner(
  message: string,
  opts: NotifyOptions = {},
): Promise<{ delivered: boolean; reason?: string }> {
  const bot = senderBot();
  if (!bot) {
    logger.debug({ message }, 'Telegram not configured; notification dropped');
    return { delivered: false, reason: 'not_configured' };
  }

  const targets: string[] = [];
  if (config.telegram.groupChatId) targets.push(config.telegram.groupChatId);
  if (targets.length === 0) {
    logger.debug({ message }, 'No notification targets configured');
    return { delivered: false, reason: 'no_targets' };
  }

  const sendOpts: Parameters<typeof bot.telegram.sendMessage>[2] = {
    disable_notification: opts.disableNotification ?? false,
    link_preview_options: { is_disabled: true },
  };
  if (opts.parseMode) sendOpts.parse_mode = opts.parseMode;

  let anyOk = false;
  const failures: string[] = [];
  for (const chatId of targets) {
    try {
      await bot.telegram.sendMessage(chatId, message, sendOpts);
      anyOk = true;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      logger.warn({ chatId, reason }, 'Telegram send failed for one target');
      failures.push(`${chatId}: ${reason}`);
    }
  }
  if (anyOk) {
    return failures.length > 0
      ? { delivered: true, reason: `partial: ${failures.join('; ')}` }
      : { delivered: true };
  }
  return { delivered: false, reason: failures.join('; ') };
}

/** Identity function kept for callsite compatibility — we no longer use
 *  parse_mode by default, so no escaping is needed. Returns input as-is. */
export function escapeMd(s: string): string {
  return s;
}
