import { eq } from 'drizzle-orm';
import { db, appConfig as config, logger } from '../00-foundation/index.js';
import { kieCredentials } from '../../db/schema/kie-credentials.js';

const DEFAULT_LABEL = 'env-bootstrap';

/**
 * Idempotently seed `kie_credentials` dari env `KIE_API_KEY`.
 *
 * Behavior:
 *  - Kalau env tidak set → no-op (return false, log warn).
 *  - Kalau row dengan label "env-bootstrap" sudah ada DAN api_key sama
 *    DAN status='active' → no-op (return false).
 *  - Kalau row ada tapi api_key beda → update key + activate
 *    (handle key rotation via env restart).
 *  - Kalau row belum ada → insert baru.
 *
 * Dipanggil lazy oleh handler — bukan di startup — supaya boot tidak
 * fail kalau DB sedang down dan KIE memang belum dipakai.
 */
export async function ensureKieCredentialFromEnv(): Promise<{
  seeded: boolean;
  credentialId: string | null;
}> {
  if (!config.kie.isConfigured || !config.kie.apiKey) {
    logger.warn('KIE_API_KEY not set in env — skipping credential bootstrap');
    return { seeded: false, credentialId: null };
  }
  const apiKey = config.kie.apiKey;

  const [existing] = await db
    .select()
    .from(kieCredentials)
    .where(eq(kieCredentials.label, DEFAULT_LABEL))
    .limit(1);

  if (existing) {
    if (existing.apiKey === apiKey && existing.status === 'active') {
      return { seeded: false, credentialId: existing.id };
    }
    // Update — handles key rotation atau status reset.
    await db
      .update(kieCredentials)
      .set({
        apiKey,
        status: 'active',
        invalidReason: null,
        updatedAt: new Date(),
      })
      .where(eq(kieCredentials.id, existing.id));
    logger.info({ credentialId: existing.id }, 'KIE credential refreshed from env');
    return { seeded: true, credentialId: existing.id };
  }

  const [row] = await db
    .insert(kieCredentials)
    .values({
      label: DEFAULT_LABEL,
      apiKey,
      status: 'active',
    })
    .returning({ id: kieCredentials.id });
  if (!row) {
    logger.error('KIE credential insert returned no row');
    return { seeded: false, credentialId: null };
  }
  logger.info({ credentialId: row.id }, 'KIE credential seeded from env');
  return { seeded: true, credentialId: row.id };
}
