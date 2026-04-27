import type { Context } from 'telegraf';
import { config } from '../../config/env.js';

/**
 * Allowed scope = owner DM (TELEGRAM_CHAT_ID) OR the configured group chat
 * (TELEGRAM_GROUP_CHAT_ID). Anything else is silently ignored to avoid
 * spamming replies to random users that DM the bot.
 */
export function isAllowedChat(ctx: Context): boolean {
  const chatId = ctx.chat?.id;
  if (chatId === undefined) return false;
  const owner = config.telegram.ownerChatId;
  const group = config.telegram.groupChatId;
  if (owner && String(chatId) === String(owner)) return true;
  if (group && String(chatId) === String(group)) return true;
  return false;
}

/**
 * Approver = a Telegram user ID listed in TELEGRAM_APPROVED_USER_IDS.
 * Approvers can run write commands and confirm pending actions; everyone
 * else in an allowed chat gets read-only access.
 *
 * Backward-compat: if no approver list is configured, we fall back to "any
 * member of an allowed chat" so existing single-owner setups still work.
 */
export function isApprover(ctx: Context): boolean {
  const userId = ctx.from?.id;
  if (userId === undefined) return false;
  const approved = config.telegram.approvedUserIds;
  if (approved.length === 0) {
    // No list configured → owner DM is the de-facto approver
    return isAllowedChat(ctx) && String(ctx.chat?.id) === String(config.telegram.ownerChatId);
  }
  return approved.includes(String(userId));
}

/** Gate for read commands. Silently ignores chats that aren't owner DM or
 *  the configured group. Returns true when the handler should proceed. */
export async function requireMember(ctx: Context): Promise<boolean> {
  if (!isAllowedChat(ctx)) return false; // silent
  return true;
}

/** Gate for write / approval commands. Silently ignores wrong chats; tells
 *  in-chat non-approvers (e.g. Raafi) that they need to ask an approver. */
export async function requireApprover(ctx: Context): Promise<boolean> {
  if (!isAllowedChat(ctx)) return false; // silent
  if (!isApprover(ctx)) {
    await ctx.reply(
      'Maaf, kamu tidak punya akses untuk aksi ini. Hubungi Bang Rian atau Naila.',
    );
    return false;
  }
  return true;
}

// ---------- Legacy shims (still imported by the bot bootstrap) ----------

/** Legacy alias — true when the message is from any allowed chat. Kept so
 *  older callsites compile while we migrate to requireMember/requireApprover. */
export function isOwner(ctx: Context): boolean {
  return isAllowedChat(ctx);
}

export async function rejectIfNotOwner(ctx: Context): Promise<boolean> {
  if (await requireMember(ctx)) return false;
  return true;
}
