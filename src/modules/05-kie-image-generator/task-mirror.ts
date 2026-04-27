import { eq } from 'drizzle-orm';
import { db, logger } from '../00-foundation/index.js';
import { kieTasks } from '../../db/schema/kie-tasks.js';

/**
 * Mirror: setiap content_assets row punya parallel kie_tasks row.
 * `content_assets` dipakai untuk media library + asset retention;
 * `kie_tasks` dipakai untuk task lifecycle tracking + billing analytics
 * (per blueprint design — lihat 00-foundation/PRD.md).
 *
 * Helper ini insert-or-update berdasarkan provider task id (mapped ke
 * output_payload.providerTaskId).
 */

export interface MirrorPendingInput {
  taskType: 'image.generate' | 'image.edit';
  provider: 'kie.playground.nano-banana' | 'kie.gpt4o-image';
  providerTaskId: string;
  prompt: string;
  inputParams: Record<string, unknown>;
  createdBy: string | null;
  /** TTL — selaras dengan content_assets retention (default 14 hari). */
  expiresAt: Date | null;
}

export async function mirrorTaskPending(input: MirrorPendingInput): Promise<string | null> {
  try {
    const [row] = await db
      .insert(kieTasks)
      .values({
        taskType: input.taskType,
        status: 'in_progress',
        provider: input.provider,
        inputPayload: {
          prompt: input.prompt,
          ...input.inputParams,
          providerTaskId: input.providerTaskId,
        } as never,
        createdBy: input.createdBy,
        expiresAt: input.expiresAt,
      })
      .returning({ id: kieTasks.id });
    return row?.id ?? null;
  } catch (err) {
    logger.warn({ err, providerTaskId: input.providerTaskId }, 'kie_tasks mirror insert failed (non-fatal)');
    return null;
  }
}

export async function mirrorTaskSucceeded(
  kieTaskId: string,
  resultUrls: string[],
  creditsUsed: number | null,
): Promise<void> {
  try {
    await db
      .update(kieTasks)
      .set({
        status: 'succeeded',
        outputPayload: { resultUrls } as never,
        creditsUsed,
        updatedAt: new Date(),
      })
      .where(eq(kieTasks.id, kieTaskId));
  } catch (err) {
    logger.warn({ err, kieTaskId }, 'kie_tasks mirror update failed');
  }
}

export async function mirrorTaskFailed(
  kieTaskId: string,
  errorMessage: string,
): Promise<void> {
  try {
    await db
      .update(kieTasks)
      .set({
        status: 'failed',
        outputPayload: { error: errorMessage } as never,
        updatedAt: new Date(),
      })
      .where(eq(kieTasks.id, kieTaskId));
  } catch (err) {
    logger.warn({ err, kieTaskId }, 'kie_tasks mirror failure-update failed');
  }
}
