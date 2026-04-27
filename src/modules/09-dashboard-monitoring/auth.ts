import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { appConfig as config } from '../00-foundation/index.js';

export interface DashboardSession {
  username: string;
  issuedAt: number;
  nonce: string;
}

const COOKIE_NAME = 'maa_session';

export function createSessionCookie(username: string): string {
  const secret = ensureSecret();
  const session: DashboardSession = {
    username,
    issuedAt: Date.now(),
    nonce: randomBytes(8).toString('hex'),
  };
  const payload = base64UrlEncode(JSON.stringify(session));
  const signature = sign(payload, secret);
  const value = `${payload}.${signature}`;
  const maxAge = Math.floor(config.dashboard.sessionTtlMs / 1000);
  const flags = [
    `${COOKIE_NAME}=${value}`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/',
    `Max-Age=${maxAge}`,
  ];
  if (config.isProd) flags.push('Secure');
  return flags.join('; ');
}

export function clearSessionCookie(): string {
  const flags = [
    `${COOKIE_NAME}=`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/',
    'Max-Age=0',
  ];
  if (config.isProd) flags.push('Secure');
  return flags.join('; ');
}

export function readSession(req: FastifyRequest): DashboardSession | null {
  if (!config.dashboard.sessionSecret) return null;
  const raw = parseCookie(req.headers.cookie ?? '', COOKIE_NAME);
  if (!raw) return null;
  const dot = raw.lastIndexOf('.');
  if (dot < 1) return null;
  const payload = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expected = sign(payload, config.dashboard.sessionSecret);
  if (!safeEqual(sig, expected)) return null;
  let parsed: DashboardSession;
  try {
    parsed = JSON.parse(base64UrlDecode(payload)) as DashboardSession;
  } catch {
    return null;
  }
  if (Date.now() - parsed.issuedAt > config.dashboard.sessionTtlMs) return null;
  return parsed;
}

export function verifyCredentials(username: string, password: string): boolean {
  if (!config.dashboard.password) return false;
  const userOk = safeEqual(username, config.dashboard.username);
  const passOk = safeEqual(password, config.dashboard.password);
  return userOk && passOk;
}

/**
 * Fastify preHandler that redirects unauthenticated requests to /login.
 */
export async function requireAuth(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const session = readSession(req);
  if (!session) {
    reply.code(302).header('Location', '/login').send();
    return;
  }
  // Decorated request access — set on the request for view rendering.
  (req as FastifyRequest & { dashboardSession?: DashboardSession }).dashboardSession = session;
}

function ensureSecret(): string {
  const s = config.dashboard.sessionSecret;
  if (!s) {
    throw new Error(
      'Dashboard session secret not configured (set DASHBOARD_SESSION_SECRET).',
    );
  }
  return s;
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function base64UrlEncode(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64url');
}

function base64UrlDecode(s: string): string {
  return Buffer.from(s, 'base64url').toString('utf8');
}

function parseCookie(header: string, name: string): string | null {
  if (!header) return null;
  const parts = header.split(';');
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (key === name) return part.slice(eq + 1).trim();
  }
  return null;
}
