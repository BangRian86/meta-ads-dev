import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import type { Context } from 'telegraf';
import { logger } from '../00-foundation/index.js';

/**
 * Telegram → Claude Code CLI bridge.
 *
 * SECURITY MODEL — read carefully before changing:
 *  - Akses dibatasi ke satu chat ID (Bang Rian) by hardcoded constant.
 *    Bukan diambil dari env atau approver list — tidak ada cara untuk
 *    "promote" user lain ke /claude tanpa edit kode + restart.
 *  - Tidak ada fallback "kalau env kosong → owner". Strictly chat ID match.
 *  - Reject silent untuk non-Bang-Rian. Tidak leak existence command ke
 *    Naila/Raafi/random.
 *  - Confirmation step (/claude_yes vs /claude_no) memberi pause window
 *    sebelum eksekusi — kalau Bang Rian salah ketik atau Telegram-nya
 *    di-hijack, ada 60 detik untuk batalkan via /claude_no atau timeout.
 *  - Eksekusi pakai spawn dengan args explicit + stdin pipe — TIDAK
 *    pakai shell interpolation. Jadi tidak ada injection lewat
 *    backtick / pipe / semicolon di dalam perintah.
 *  - Setiap eksekusi dilog ke file untuk audit trail.
 */

const BANG_RIAN_CHAT_ID = '562855924';
const PENDING_TTL_MS = 60_000; // 60 detik window konfirmasi
const EXEC_TIMEOUT_MS = 5 * 60_000; // 5 menit hard cap
const MAX_COMMAND_LEN = 2000; // hindari abuse / accident
const CHUNK_SIZE = 4000;
const CWD = '/root/meta-ads-dev';
const CLAUDE_BIN = '/root/.nvm/versions/node/v22.22.1/bin/claude';
const DEVLOG_PATH = '/tmp/maa-claude-bridge.log';
const DEVLOG_KEEP = 10; // simpan N eksekusi terakhir

interface PendingCommand {
  command: string;
  requestedAt: number;
}

interface DevLogEntry {
  ts: string;
  command: string;
  exitCode: number | null;
  durationMs: number;
  stdoutLen: number;
  stderrLen: number;
  timedOut: boolean;
  preview: string; // ringkasan output buat /devlog
}

const pendingByUserId = new Map<number, PendingCommand>();

/** True kalau ctx.from.id match hardcoded Bang Rian ID. */
export function isBangRian(ctx: Context): boolean {
  const userId = ctx.from?.id;
  if (userId === undefined) return false;
  return String(userId) === BANG_RIAN_CHAT_ID;
}

/** Wrapper handler — kalau bukan Bang Rian, silent reject (no reply). */
function gateBangRian<T extends (ctx: Context, args: string[]) => Promise<void>>(fn: T): T {
  return (async (ctx: Context, args: string[]) => {
    if (!isBangRian(ctx)) {
      // Silent reject — jangan leak existence /claude ke user lain.
      return;
    }
    await fn(ctx, args);
  }) as T;
}

// ---------- /claude /dev — submit perintah ----------

async function claudeSubmit(ctx: Context, args: string[]): Promise<void> {
  const command = args.join(' ').trim();
  if (!command) {
    await ctx.reply(
      'Usage: /claude <perintah>\nContoh: /claude fix bug conversation history di ai-handler.ts',
    );
    return;
  }
  if (command.length > MAX_COMMAND_LEN) {
    await ctx.reply(
      `Perintah terlalu panjang (${command.length} char). Max ${MAX_COMMAND_LEN}.`,
    );
    return;
  }
  const userId = ctx.from!.id;
  pendingByUserId.set(userId, { command, requestedAt: Date.now() });
  await ctx.reply(
    `🤖 Konfirmasi eksekusi Claude Code:\n\n` +
      `▸ ${truncate(command, 800)}\n\n` +
      `Yakin jalankan perintah ini?\n` +
      `  /claude_yes  → eksekusi sekarang\n` +
      `  /claude_no   → batalkan\n\n` +
      `(Auto-expired ${Math.round(PENDING_TTL_MS / 1000)} detik)`,
  );
}

export const handleClaudeCommand = gateBangRian(claudeSubmit);
export const handleDevCommand = gateBangRian(claudeSubmit); // alias /dev

// ---------- /claude_yes — eksekusi ----------

async function claudeConfirm(ctx: Context, _args: string[]): Promise<void> {
  const userId = ctx.from!.id;
  const pending = pendingByUserId.get(userId);
  if (!pending) {
    await ctx.reply(
      'Tidak ada perintah pending. Kirim /claude <perintah> dulu, baru /claude_yes.',
    );
    return;
  }
  if (Date.now() - pending.requestedAt > PENDING_TTL_MS) {
    pendingByUserId.delete(userId);
    await ctx.reply(
      `Perintah sudah expired (>${Math.round(PENDING_TTL_MS / 1000)} detik). Kirim /claude lagi.`,
    );
    return;
  }
  pendingByUserId.delete(userId);

  await ctx.reply(`▶️ Eksekusi: ${truncate(pending.command, 200)}\n(timeout 5 menit)`);
  try {
    await ctx.sendChatAction('typing');
  } catch {
    // best-effort
  }

  const result = await runClaudeCli(pending.command);
  await appendDevLog({
    ts: new Date().toISOString(),
    command: pending.command,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    stdoutLen: result.stdout.length,
    stderrLen: result.stderr.length,
    timedOut: result.timedOut,
    preview: previewOutput(result.stdout, result.stderr, result.timedOut),
  });

  await sendResult(ctx, pending.command, result);
}

export const handleClaudeConfirm = gateBangRian(claudeConfirm);

// ---------- /claude_no — batal ----------

async function claudeCancel(ctx: Context, _args: string[]): Promise<void> {
  const userId = ctx.from!.id;
  const had = pendingByUserId.delete(userId);
  await ctx.reply(had ? '❌ Dibatalkan.' : 'Tidak ada perintah pending.');
}

export const handleClaudeCancel = gateBangRian(claudeCancel);

// ---------- /devlog — riwayat eksekusi ----------

async function devLog(ctx: Context, _args: string[]): Promise<void> {
  let entries: DevLogEntry[];
  try {
    entries = await readDevLog();
  } catch (err) {
    logger.warn({ err }, 'devlog read failed');
    await ctx.reply('Belum ada log eksekusi (atau gagal baca file).');
    return;
  }
  if (entries.length === 0) {
    await ctx.reply('Belum ada log eksekusi.');
    return;
  }
  const lines: string[] = [`📜 Riwayat eksekusi Claude (${entries.length} terakhir):\n`];
  // Tampilkan dari terbaru ke terlama
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]!;
    const idx = entries.length - i;
    const status = e.timedOut
      ? '⏱️ timeout'
      : e.exitCode === 0
        ? '✅ ok'
        : `❌ exit=${e.exitCode}`;
    lines.push(
      `${idx}. ${e.ts}  ${status}  ${Math.round(e.durationMs / 1000)}s\n` +
        `   ▸ ${truncate(e.command, 120)}\n` +
        `   ${truncate(e.preview, 300)}`,
    );
  }
  const text = lines.join('\n\n');
  for (const c of chunk(text)) await ctx.reply(c);
}

export const handleDevLogCommand = gateBangRian(devLog);

// ---------- Eksekusi shell (no shell) ----------

interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  timedOut: boolean;
}

/**
 * Spawn `claude --print` dengan command via stdin. SENGAJA tidak pakai
 * `shell: true` supaya quoting dan special chars dalam perintah tidak
 * di-interpret sebagai shell metacharacter — jadi tidak ada injection
 * meski perintah berisi `$()`, `;`, `|`, dll.
 */
async function runClaudeCli(command: string): Promise<ExecResult> {
  const start = Date.now();
  return new Promise<ExecResult>((resolve) => {
    const child = spawn(CLAUDE_BIN, ['--print'], {
      cwd: CWD,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      // Hard kill 5 detik kemudian kalau SIGTERM nggak nendang
      setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL');
      }, 5_000);
    }, EXEC_TIMEOUT_MS);

    child.stdout.on('data', (b: Buffer) => {
      stdout += b.toString('utf8');
    });
    child.stderr.on('data', (b: Buffer) => {
      stderr += b.toString('utf8');
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      logger.error({ err }, 'claude-bridge: spawn error');
      stderr += `\n[spawn error] ${err.message}`;
      resolve({
        stdout,
        stderr,
        exitCode: null,
        durationMs: Date.now() - start,
        timedOut,
      });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        stdout,
        stderr,
        exitCode: code,
        durationMs: Date.now() - start,
        timedOut,
      });
    });

    // Tulis perintah ke stdin lalu close — claude --print baca dari stdin.
    child.stdin.write(command);
    child.stdin.end();
  });
}

// ---------- Output rendering ----------

async function sendResult(
  ctx: Context,
  command: string,
  result: ExecResult,
): Promise<void> {
  const headerLines: string[] = [];
  if (result.timedOut) {
    headerLines.push(`⏱️ Timeout setelah ${Math.round(result.durationMs / 1000)}s.`);
  } else if (result.exitCode === 0) {
    headerLines.push(`✅ Selesai dalam ${Math.round(result.durationMs / 1000)}s.`);
  } else {
    headerLines.push(
      `❌ Gagal (exit=${result.exitCode}) dalam ${Math.round(result.durationMs / 1000)}s.`,
    );
  }
  headerLines.push(`▸ ${truncate(command, 200)}`);

  const body = result.stdout || (result.stderr ? `[stderr]\n${result.stderr}` : '(no output)');
  const fullText = `${headerLines.join('\n')}\n\n${body}`;
  for (const c of chunk(fullText)) await ctx.reply(c);

  // Stderr terpisah hanya kalau exit 0 tapi ada warning di stderr (info)
  if (result.exitCode === 0 && result.stderr.trim().length > 0) {
    for (const c of chunk(`[stderr]\n${result.stderr}`)) await ctx.reply(c);
  }
}

function previewOutput(stdout: string, stderr: string, timedOut: boolean): string {
  if (timedOut) return '(timeout)';
  const src = stdout.trim() || stderr.trim();
  if (!src) return '(no output)';
  return truncate(src.split('\n').slice(0, 3).join(' | '), 280);
}

function chunk(text: string): string[] {
  if (text.length <= CHUNK_SIZE) return [text];
  const out: string[] = [];
  let remaining = text;
  while (remaining.length > CHUNK_SIZE) {
    const slice = remaining.slice(0, CHUNK_SIZE);
    // Pisah di newline kalau bisa, supaya nggak cut tengah baris
    const cut =
      slice.lastIndexOf('\n\n') > CHUNK_SIZE / 2
        ? slice.lastIndexOf('\n\n')
        : slice.lastIndexOf('\n') > CHUNK_SIZE / 2
          ? slice.lastIndexOf('\n')
          : CHUNK_SIZE;
    out.push(remaining.slice(0, cut).trimEnd());
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining.length > 0) out.push(remaining);
  return out;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

// ---------- Devlog file persistence ----------

async function readDevLog(): Promise<DevLogEntry[]> {
  try {
    const raw = await fs.readFile(DEVLOG_PATH, 'utf8');
    if (!raw.trim()) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed as DevLogEntry[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

async function appendDevLog(entry: DevLogEntry): Promise<void> {
  try {
    const existing = await readDevLog();
    existing.push(entry);
    const trimmed = existing.slice(-DEVLOG_KEEP);
    await fs.writeFile(DEVLOG_PATH, JSON.stringify(trimmed, null, 2), 'utf8');
  } catch (err) {
    logger.warn({ err }, 'claude-bridge: devlog write failed');
  }
}
