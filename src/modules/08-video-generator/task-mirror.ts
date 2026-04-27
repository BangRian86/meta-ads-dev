import { eq } from 'drizzle-orm';
import { db } from '../00-foundation/index.js';
import { logger } from '../00-foundation/index.js';
import { kieTasks } from '../../db/schema/kie-tasks.js';

/**
 * Mirror video-task lifecycle ke `kie_tasks`. Sama paradigm dengan image
 * module's task-mirror tapi task_type pakai 'video.*' supaya billing
 * analytics bisa pisahin video vs image (credit Wan jauh lebih mahal).
 *
 * `kie_tasks.task_type` field-nya text, jadi nggak butuh migration enum.
 */

export type VideoTaskType = 'video.generate' | 'video.image_to_video';

export interface MirrorVideoPendingInput {
  taskType: VideoTaskType;
  /** Provider sub-id, mis. "kie.jobs.wan-2-7.t2v". */
  provider: string;
  providerTaskId: string;
  prompt: string;
  inputParams: Record<string, unknown>;
  createdBy: string | null;
  expiresAt: Date | null;
}

export async function mirrorVideoTaskPending(
  input: MirrorVideoPendingInput,
): Promise<string | null> {
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
    logger.warn(
      { err, providerTaskId: input.providerTaskId },
      'kie_tasks mirror insert failed (video, non-fatal)',
    );
    return null;
  }
}

export async function mirrorVideoTaskSucceeded(
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
    logger.warn({ err, kieTaskId }, 'kie_tasks mirror update failed (video)');
  }
}

export async function mirrorVideoTaskFailed(
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
    logger.warn({ err, kieTaskId }, 'kie_tasks mirror failure-update failed (video)');
  }
}
