import type { Context, MiddlewareFn } from 'telegraf';
import { logger } from '../../lib/logger.js';

/**
 * Middleware: di group/supergroup, drop pesan kecuali memenuhi salah satu:
 *   1. Pesan diawali slash command (text/caption start dengan "/")
 *   2. Pesan mengandung mention @<botUsername> (case-insensitive,
 *      word-boundary supaya "@botUsername_extra" tidak match)
 *   3. Pesan adalah konfirmasi approval pendek ("ya" / "tidak" / variannya)
 *      — supaya approver bisa balas pending action di group tanpa harus
 *      mention bot. Downstream handler (commands.ts text handler) verify
 *      isApprover + isApprover-only sebelum eksekusi.
 *
 * DM (chat.type === 'private') selalu lolos — semua pesan direspon.
 * Channel posts dan tipe lain pakai default behavior (lolos).
 *
 * Pasang via `bot.use(groupFilter())` SEBELUM `registerCommands(bot)`
 * di bot.ts — Telegraf middleware urutan-sensitif.
 */

// Pattern yang sama persis dengan isAffirmative/isNegative di commands.ts —
// duplikasi sengaja supaya filter bisa decide tanpa import lingkaran.
const APPROVAL_REPLY_RE = /^(ya|yes|iya|ok|oke|okay|tidak|no|batal|cancel|nggak|gak|ga)\s*[.!]?\s*$/i;
export function groupFilter(): MiddlewareFn<Context> {
  return async (ctx, next) => {
    const chat = ctx.chat;
    if (!chat) return next();

    if (chat.type === 'private') {
      return next();
    }
    if (chat.type !== 'group' && chat.type !== 'supergroup') {
      return next();
    }

    // Pesan biasa atau pesan yang sudah di-edit di group.
    const message = ctx.message ?? ctx.editedMessage;
    if (!message) {
      // Update non-message (callback_query, member status, dll) — biarkan
      // lewat supaya alur button approval / event handler lain tetap jalan.
      return next();
    }

    const rawText =
      ('text' in message && typeof message.text === 'string'
        ? message.text
        : '') ||
      ('caption' in message && typeof message.caption === 'string'
        ? message.caption
        : '');

    if (!rawText) {
      // Sticker, photo tanpa caption, voice note, dll — drop.
      return;
    }

    const isCommand = rawText.trimStart().startsWith('/');

    const botUsername = ctx.botInfo?.username?.toLowerCase() ?? '';
    const isMentioned =
      botUsername.length > 0 &&
      mentionsBot(rawText.toLowerCase(), botUsername);

    // Approver short-reply: "ya" / "tidak" / etc. Filter cuma cek bentuknya;
    // gating approver + ada-pending-atau-tidak di-handle downstream di
    // commands.ts text handler. Kalau pesannya bukan approver, downstream
    // balas polite refusal — tetap lolos filter supaya konsisten.
    const isApprovalReply = APPROVAL_REPLY_RE.test(rawText.trim());

    if (isCommand || isMentioned || isApprovalReply) {
      return next();
    }

    logger.debug(
      {
        chatId: chat.id,
        fromId: message.from?.id,
        username: message.from?.username,
        textPreview: rawText.slice(0, 40),
      },
      '[GROUP_FILTER] no trigger — diam',
    );
    // do not call next() → bot stays silent
  };
}

function mentionsBot(loweredText: string, loweredBotUsername: string): boolean {
  const target = '@' + loweredBotUsername;
  const idx = loweredText.indexOf(target);
  if (idx === -1) return false;
  // Karakter sesudah username harus bukan letter/digit/underscore — supaya
  // "@bot" cocok tapi "@bottom" tidak cocok dengan "@bot".
  const after = loweredText.charCodeAt(idx + target.length);
  if (Number.isNaN(after)) return true; // end of string
  const isWordChar =
    (after >= 48 && after <= 57) || // 0-9
    (after >= 97 && after <= 122) || // a-z (already lowered)
    after === 95; // _
  return !isWordChar;
}
