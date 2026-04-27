import { eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { metaConnections, metaRequestLogs } from '../db/schema/index.js';
import type { MetaConnection } from '../db/schema/meta-connections.js';
import { config } from '../config/env.js';
import { logger } from './logger.js';
import { mapHttpFailure, mapMetaError, type MappedMetaError } from './error-mapper.js';

/**
 * Thrown when a connection's token is invalid/expired/revoked. The system halts
 * the affected operation; the owner must replace the token before work resumes.
 */
export class TokenInvalidError extends Error {
  override readonly name = 'TokenInvalidError';
  constructor(
    public readonly connectionId: string,
    public readonly reason: string,
    public readonly mapped?: MappedMetaError,
  ) {
    super(
      `Meta token for connection ${connectionId} is invalid (${reason}). ` +
        `Owner must replace the token — system halted.`,
    );
  }
}

/**
 * Returns an active connection or throws TokenInvalidError. Use this at the top of
 * every Meta API call site so we never make outbound calls with a known-bad token.
 *
 * Performs a live `/me` validation if the cached lastValidatedAt is older than
 * config.tokenValidateIntervalMs.
 */
export async function requireActiveConnection(connectionId: string): Promise<MetaConnection> {
  const connection = await loadConnection(connectionId);

  if (connection.status !== 'active') {
    throw new TokenInvalidError(connectionId, connection.invalidReason ?? connection.status);
  }

  if (connection.expiresAt && connection.expiresAt.getTime() <= Date.now()) {
    await markInvalid(connectionId, 'expired', 'Token expiresAt has passed');
    throw new TokenInvalidError(connectionId, 'expired');
  }

  if (shouldRevalidate(connection)) {
    await validateLive(connection);
  }

  return connection;
}

/**
 * Validates the connection's token against Meta's `/me` endpoint. On auth failure,
 * marks the connection invalid and throws TokenInvalidError. Other transient
 * failures are logged but do not flip the connection state.
 */
export async function validateLive(connection: MetaConnection): Promise<void> {
  const url = new URL(`${config.meta.graphUrl}/me`);
  url.searchParams.set('fields', 'id,name');
  url.searchParams.set('access_token', connection.accessToken);

  const start = Date.now();
  let status = 0;
  let payload: unknown = null;

  try {
    const res = await fetch(url, { method: 'GET' });
    status = res.status;
    payload = await res.json().catch(() => null);

    if (!res.ok) {
      const mapped = payload
        ? mapMetaError(payload)
        : mapHttpFailure(status, res.statusText, payload);
      await logRequest(connection.id, 'GET', '/me', null, status, payload, mapped, Date.now() - start);

      if (mapped.requiresTokenReplacement) {
        await markInvalid(connection.id, mapped.code, mapped.message);
        throw new TokenInvalidError(connection.id, mapped.code, mapped);
      }

      logger.warn(
        { connectionId: connection.id, mapped },
        'Token validation hit non-auth failure — leaving connection active',
      );
      return;
    }

    await logRequest(connection.id, 'GET', '/me', null, status, payload, null, Date.now() - start);
    await db
      .update(metaConnections)
      .set({ lastValidatedAt: new Date(), updatedAt: new Date() })
      .where(eq(metaConnections.id, connection.id));
  } catch (err) {
    if (err instanceof TokenInvalidError) throw err;
    logger.error(
      { err, connectionId: connection.id },
      'Network error during token validation',
    );
    await logRequest(
      connection.id,
      'GET',
      '/me',
      null,
      status || 0,
      payload,
      null,
      Date.now() - start,
      err instanceof Error ? err.message : String(err),
    );
  }
}

/**
 * Marks the connection invalid. Idempotent. Always emits an error-level log so
 * an operator can react.
 */
export async function markInvalid(
  connectionId: string,
  reason: string,
  detail?: string,
): Promise<void> {
  await db
    .update(metaConnections)
    .set({
      status: reason === 'expired' ? 'expired' : 'invalid',
      invalidReason: detail ? `${reason}: ${detail}` : reason,
      updatedAt: new Date(),
    })
    .where(eq(metaConnections.id, connectionId));

  logger.error(
    { connectionId, reason, detail },
    'Meta connection marked invalid — owner must replace token',
  );
}

/**
 * Replaces the access token for a connection. Used after the owner manually
 * provides a fresh token. Resets status to active and clears invalidReason.
 */
export async function replaceToken(
  connectionId: string,
  accessToken: string,
  opts: { tokenType?: 'short_lived' | 'long_lived' | 'system_user'; expiresAt?: Date | null } = {},
): Promise<void> {
  await db
    .update(metaConnections)
    .set({
      accessToken,
      tokenType: opts.tokenType ?? 'long_lived',
      expiresAt: opts.expiresAt ?? null,
      status: 'active',
      invalidReason: null,
      lastValidatedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(metaConnections.id, connectionId));

  logger.info({ connectionId }, 'Meta token replaced — connection re-activated');
}

async function loadConnection(connectionId: string): Promise<MetaConnection> {
  const [row] = await db
    .select()
    .from(metaConnections)
    .where(eq(metaConnections.id, connectionId))
    .limit(1);
  if (!row) {
    throw new Error(`Meta connection not found: ${connectionId}`);
  }
  return row;
}

function shouldRevalidate(connection: MetaConnection): boolean {
  if (!connection.lastValidatedAt) return true;
  const age = Date.now() - connection.lastValidatedAt.getTime();
  return age >= config.tokenValidateIntervalMs;
}

async function logRequest(
  connectionId: string,
  method: string,
  endpoint: string,
  params: unknown,
  status: number,
  body: unknown,
  mapped: MappedMetaError | null,
  durationMs: number,
  errorMessage?: string,
): Promise<void> {
  try {
    await db.insert(metaRequestLogs).values({
      connectionId,
      method,
      endpoint,
      requestParams: params as never,
      responseStatus: status,
      responseBody: (body ?? (errorMessage ? { error: errorMessage } : null)) as never,
      errorCode: mapped?.code ?? null,
      errorSubcode: mapped?.subcode ?? null,
      errorKind: mapped?.kind ?? null,
      durationMs,
    });
  } catch (err) {
    logger.error({ err }, 'Failed to write meta_request_logs row');
  }
}

// sql is re-exported for callers that need raw SQL on the connection (kept thin
// to avoid importing drizzle in lib code elsewhere).
export { sql };
