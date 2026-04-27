import { and, eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import {
  metaRuleDrafts,
  type MetaRuleDraft,
  type NewMetaRuleDraft,
} from '../../db/schema/meta-rule-drafts.js';
import type {
  EvaluationSpec,
  ExecutionSpec,
  RuleStatusIntent,
  ScheduleSpec,
} from './schema.js';

export interface DraftCore {
  name: string;
  statusIntent: RuleStatusIntent;
  evaluationSpec: EvaluationSpec;
  executionSpec: ExecutionSpec;
  scheduleSpec?: ScheduleSpec | undefined;
  notes?: string | undefined;
}

export async function insertDraft(
  connectionId: string,
  draft: DraftCore,
): Promise<MetaRuleDraft> {
  const values: NewMetaRuleDraft = {
    connectionId,
    name: draft.name,
    statusIntent: draft.statusIntent,
    evaluationSpec: draft.evaluationSpec as never,
    executionSpec: draft.executionSpec as never,
    scheduleSpec: (draft.scheduleSpec ?? null) as never,
    notes: draft.notes ?? null,
  };
  const [row] = await db.insert(metaRuleDrafts).values(values).returning();
  if (!row) {
    throw new Error('Failed to insert meta_rule_draft');
  }
  return row;
}

export async function patchDraft(
  draftId: string,
  patch: Partial<DraftCore>,
): Promise<MetaRuleDraft> {
  const updateValues: Partial<NewMetaRuleDraft> & { updatedAt: Date } = {
    updatedAt: new Date(),
  };
  if (patch.name !== undefined) updateValues.name = patch.name;
  if (patch.statusIntent !== undefined) updateValues.statusIntent = patch.statusIntent;
  if (patch.evaluationSpec !== undefined) {
    updateValues.evaluationSpec = patch.evaluationSpec as never;
  }
  if (patch.executionSpec !== undefined) {
    updateValues.executionSpec = patch.executionSpec as never;
  }
  if (patch.scheduleSpec !== undefined) {
    updateValues.scheduleSpec = (patch.scheduleSpec ?? null) as never;
  }
  if (patch.notes !== undefined) updateValues.notes = patch.notes;

  const [row] = await db
    .update(metaRuleDrafts)
    .set(updateValues)
    .where(
      and(
        eq(metaRuleDrafts.id, draftId),
        eq(metaRuleDrafts.state, 'draft'),
      ),
    )
    .returning();
  if (!row) {
    throw new DraftNotEditableError(draftId);
  }
  return row;
}

export async function getDraft(draftId: string): Promise<MetaRuleDraft | null> {
  const [row] = await db
    .select()
    .from(metaRuleDrafts)
    .where(eq(metaRuleDrafts.id, draftId))
    .limit(1);
  return row ?? null;
}

export async function markDraftDiscarded(draftId: string): Promise<MetaRuleDraft> {
  const [row] = await db
    .update(metaRuleDrafts)
    .set({ state: 'discarded', updatedAt: new Date() })
    .where(
      and(
        eq(metaRuleDrafts.id, draftId),
        eq(metaRuleDrafts.state, 'draft'),
      ),
    )
    .returning();
  if (!row) {
    throw new DraftNotEditableError(draftId);
  }
  return row;
}

export async function markDraftPublished(
  draftId: string,
  publishedRuleId: string,
): Promise<MetaRuleDraft> {
  const [row] = await db
    .update(metaRuleDrafts)
    .set({
      state: 'published',
      publishedRuleId,
      publishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(metaRuleDrafts.id, draftId),
        eq(metaRuleDrafts.state, 'draft'),
      ),
    )
    .returning();
  if (!row) {
    throw new DraftNotEditableError(draftId);
  }
  return row;
}

export class DraftNotEditableError extends Error {
  override readonly name = 'DraftNotEditableError';
  constructor(public readonly draftId: string) {
    super(
      `Draft ${draftId} not found or no longer in 'draft' state — cannot modify.`,
    );
  }
}
