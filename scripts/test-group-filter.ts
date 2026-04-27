/**
 * Unit test untuk groupFilter middleware. Construct Context palsu yang
 * meniru bentuk Telegraf, panggil middleware, assert next() dipanggil
 * sesuai expectation.
 */
import type { Context } from 'telegraf';
import { groupFilter } from '../src/modules/10-telegram-bot/group-filter.js';

const BOT_ID = 8123456789;
const BOT_USERNAME = 'ADS_BANGRIAN_BOT';

interface FakeMessage {
  text?: string;
  caption?: string;
  from?: { id: number; username?: string };
  reply_to_message?: { from?: { id: number } };
  forward_from?: unknown;
  forward_from_chat?: unknown;
  forward_origin?: unknown;
}

function makeCtx(opts: {
  chatType: 'private' | 'group' | 'supergroup' | 'channel';
  text?: string;
  caption?: string;
  replyToBot?: boolean;
  replyToHuman?: boolean;
  forwarded?: boolean;
  edited?: boolean;
}): Context {
  const message: FakeMessage = {};
  if (opts.text !== undefined) message.text = opts.text;
  if (opts.caption !== undefined) message.caption = opts.caption;
  if (opts.replyToBot) message.reply_to_message = { from: { id: BOT_ID } };
  if (opts.replyToHuman) message.reply_to_message = { from: { id: 99999 } };
  if (opts.forwarded) message.forward_origin = { type: 'user' };
  message.from = { id: 11111, username: 'rafi' };

  const chat = { id: -1001234567890, type: opts.chatType };

  // Telegraf Context shape — kita cuma butuh fields yang dipakai middleware.
  const ctx = {
    chat,
    botInfo: { id: BOT_ID, username: BOT_USERNAME, is_bot: true, first_name: 'ADS' },
    message: opts.edited ? undefined : message,
    editedMessage: opts.edited ? message : undefined,
  } as unknown as Context;
  return ctx;
}

let pass = 0;
let fail = 0;

async function expectAllow(label: string, ctx: Context) {
  let nextCalled = false;
  const fn = groupFilter();
  await fn(ctx, async () => {
    nextCalled = true;
  });
  if (nextCalled) {
    console.log(`  ✓ ALLOW: ${label}`);
    pass += 1;
  } else {
    console.log(`  ✗ EXPECTED ALLOW but DROPPED: ${label}`);
    fail += 1;
  }
}

async function expectDrop(label: string, ctx: Context) {
  let nextCalled = false;
  const fn = groupFilter();
  await fn(ctx, async () => {
    nextCalled = true;
  });
  if (!nextCalled) {
    console.log(`  ✓ DROP : ${label}`);
    pass += 1;
  } else {
    console.log(`  ✗ EXPECTED DROP but ALLOWED: ${label}`);
    fail += 1;
  }
}

async function main(): Promise<number> {
  console.log('=== DM (private) — selalu lolos ===');
  await expectAllow(
    'DM plain text',
    makeCtx({ chatType: 'private', text: 'gimana iklan hari ini' }),
  );
  await expectAllow(
    'DM slash command',
    makeCtx({ chatType: 'private', text: '/cs putri' }),
  );
  await expectAllow('DM no-text update', makeCtx({ chatType: 'private' }));

  console.log('\n=== Group — slash command ===');
  await expectAllow(
    '/cs putri di group',
    makeCtx({ chatType: 'supergroup', text: '/cs putri' }),
  );
  await expectAllow(
    '/roas pusat 7d di group',
    makeCtx({ chatType: 'group', text: '/roas pusat 7d' }),
  );
  await expectAllow(
    'leading whitespace + /alert',
    makeCtx({ chatType: 'supergroup', text: '   /alert' }),
  );

  console.log('\n=== Group — bot mention ===');
  await expectAllow(
    'mention dengan trailing query',
    makeCtx({
      chatType: 'supergroup',
      text: `@${BOT_USERNAME} cek roas pusat dong`,
    }),
  );
  await expectAllow(
    'mention case-insensitive',
    makeCtx({
      chatType: 'supergroup',
      text: '@ads_bangrian_bot gimana iklan hari ini',
    }),
  );
  await expectAllow(
    'mention sendiri tanpa query',
    makeCtx({ chatType: 'supergroup', text: `@${BOT_USERNAME}` }),
  );
  await expectDrop(
    'mention substring random (bukan exact)',
    makeCtx({ chatType: 'supergroup', text: '@ADS_BANGRIAN_BOTTOM gimana?' }),
  );

  console.log('\n=== Group — reply to bot ===');
  await expectAllow(
    'reply ke bot dengan plain text',
    makeCtx({
      chatType: 'supergroup',
      text: 'tolong bandingkan dengan minggu lalu',
      replyToBot: true,
    }),
  );
  await expectDrop(
    'reply ke human (bukan bot)',
    makeCtx({
      chatType: 'supergroup',
      text: 'iya bener',
      replyToHuman: true,
    }),
  );

  console.log('\n=== Group — obrolan biasa antar manusia ===');
  await expectDrop(
    'obrolan biasa tanpa trigger',
    makeCtx({
      chatType: 'supergroup',
      text: 'Halo Rafi, gimana kabar?',
    }),
  );
  await expectDrop(
    'obrolan ya/tidak tanpa reply ke bot',
    makeCtx({ chatType: 'supergroup', text: 'ya' }),
  );
  await expectDrop(
    'sticker / non-text',
    makeCtx({ chatType: 'supergroup' }),
  );

  console.log('\n=== Group — caption pada media ===');
  await expectAllow(
    'photo dengan caption /cs putri',
    makeCtx({ chatType: 'supergroup', caption: '/cs putri' }),
  );
  await expectAllow(
    'photo dengan caption mention bot',
    makeCtx({
      chatType: 'supergroup',
      caption: `@${BOT_USERNAME} cek dong`,
    }),
  );
  await expectDrop(
    'photo dengan caption obrolan',
    makeCtx({ chatType: 'supergroup', caption: 'lihat ini bagus' }),
  );

  console.log('\n=== Group — forwarded message ===');
  await expectDrop(
    'forwarded berisi mention (sengaja drop)',
    makeCtx({
      chatType: 'supergroup',
      text: `@${BOT_USERNAME} forward ini`,
      forwarded: true,
    }),
  );
  await expectDrop(
    'forwarded slash command (sengaja drop)',
    makeCtx({
      chatType: 'supergroup',
      text: '/cs putri',
      forwarded: true,
    }),
  );

  console.log('\n=== Group — edited message ===');
  await expectAllow(
    'edited message → /cs putri',
    makeCtx({
      chatType: 'supergroup',
      text: '/cs putri',
      edited: true,
    }),
  );
  await expectDrop(
    'edited message → obrolan',
    makeCtx({
      chatType: 'supergroup',
      text: 'wait nggak jadi',
      edited: true,
    }),
  );

  console.log('\n=== Channel posts ===');
  await expectAllow(
    'channel post (default-allow, non-message route)',
    makeCtx({ chatType: 'channel' }),
  );

  console.log(`\n=== Result: ${pass} pass, ${fail} fail ===`);
  return fail === 0 ? 0 : 1;
}

const code = await main();
process.exit(code);
