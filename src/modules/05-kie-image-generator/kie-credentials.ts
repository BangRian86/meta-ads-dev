import { eq } from 'drizzle-orm';
import { db } from '../00-foundation/index.js';
import { kieCredentials, type KieCredential } from '../../db/schema/kie-credentials.js';
import { logger } from '../00-foundation/index.js';

export type KieCredentialFailureReason = 'invalid_key' | 'credits_exhausted';

export class KieCredentialError extends Error {
  override readonly name = 'KieCredentialError';
  constructor(
    public readonly reason: KieCredentialFailureReason | 'no_active_key',
    public readonly credentialId: string | null,
    public readonly detail?: string,
  ) {
    super(
      reason === 'no_active_key'
        ? 'No active KIE credential — owner must add one'
        : reason === 'invalid_key'
          ? `KIE API key invalid${detail ? `: ${detail}` : ''}. Owner must replace key.`
          : `KIE credits exhausted${detail ? `: ${detail}` : ''}. Owner must top up.`,
    );
  }
}

/**
 * Returns the first active KIE credential. Throws KieCredentialError if none
 * exists; callers must surface this clearly so the operator can intervene.
 */
export async function requireActiveKieCredential(): Promise<KieCredential> {
  const [row] = await db
    .select()
    .from(kieCredentials)
    .where(eq(kieCredentials.status, 'active'))
    .limit(1);
  if (!row) throw new KieCredentialError('no_active_key', null);
  return row;
}

export async function markKieCredentialFailure(
  credentialId: string,
  reason: KieCredentialFailureReason,
  detail?: string,
): Promise<void> {
  const status = reason === 'credits_exhausted' ? 'credits_exhausted' : 'invalid';
  await db
    .update(kieCredentials)
    .set({
      status,
      invalidReason: detail ? `${reason}: ${detail}` : reason,
      updatedAt: new Date(),
    })
    .where(eq(kieCredentials.id, credentialId));
  logger.error(
    { credentialId, reason, detail },
    'KIE credential marked unusable — owner must rotate',
  );
}

export async function replaceKieKey(
  credentialId: string,
  apiKey: string,
): Promise<void> {
  await db
    .update(kieCredentials)
    .set({
      apiKey,
      status: 'active',
      invalidReason: null,
      lastValidatedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(kieCredentials.id, credentialId));
  logger.info({ credentialId }, 'KIE key replaced — credential re-activated');
}

export async function recordValidatedAt(credentialId: string): Promise<void> {
  await db
    .update(kieCredentials)
    .set({ lastValidatedAt: new Date(), updatedAt: new Date() })
    .where(eq(kieCredentials.id, credentialId));
}
