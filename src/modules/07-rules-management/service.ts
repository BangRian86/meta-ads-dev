import { recordAudit, withAudit } from '../../lib/audit-logger.js';
import { logger } from '../../lib/logger.js';
import {
  createDraftInputSchema,
  updateDraftInputSchema,
  discardDraftInputSchema,
  publishDraftInputSchema,
  updateRuleInputSchema,
  ruleStatusChangeInputSchema,
  deleteRuleInputSchema,
  refreshRuleInputSchema,
  type CreateDraftInput,
  type UpdateDraftInput,
  type DiscardDraftInput,
  type PublishDraftInput,
  type UpdateRuleInput,
  type RuleStatusChangeInput,
  type DeleteRuleInput,
  type RefreshRuleInput,
  type EvaluationSpec,
  type ExecutionSpec,
  type ScheduleSpec,
  type MetaRuleStatus,
} from './schema.js';
import {
  createRuleAtMeta,
  updateRuleAtMeta,
  setRuleStatusAtMeta,
  deleteRuleAtMeta,
  fetchRuleFromMeta,
  type UpdateRulePayload,
} from './meta-rules.js';
import {
  insertDraft,
  patchDraft,
  getDraft,
  markDraftDiscarded,
  markDraftPublished,
  DraftNotEditableError,
  type DraftCore,
} from './draft-store.js';
import {
  saveRuleSnapshot,
  saveDeletedRuleSnapshot,
  findLatestSnapshot,
  listLatestSnapshots,
  parseSnapshot,
} from './snapshot-store.js';
import { formatRule, type ReadableRule } from './formatter.js';
import type { MetaRuleDraft } from '../../db/schema/meta-rule-drafts.js';
import type { MetaRuleSnapshot } from '../../db/schema/meta-rule-snapshots.js';

// ---------- Drafts ----------

export async function createDraft(
  rawInput: CreateDraftInput,
): Promise<MetaRuleDraft> {
  const input = createDraftInputSchema.parse(rawInput);
  const draftCore: DraftCore = {
    name: input.draft.name,
    statusIntent: input.draft.statusIntent,
    evaluationSpec: input.draft.evaluationSpec,
    executionSpec: input.draft.executionSpec,
    scheduleSpec: input.draft.scheduleSpec,
    notes: input.draft.notes,
  };
  const row = await insertDraft(input.connectionId, draftCore);
  await recordAudit(
    {
      connectionId: input.connectionId,
      operationType: 'rule.draft.create',
      targetType: 'rule_draft',
      targetId: row.id,
      actorId: input.actorId ?? null,
      requestBody: { name: row.name, statusIntent: row.statusIntent },
    },
    { status: 'success', durationMs: 0, responseBody: { draftId: row.id } },
  );
  return row;
}

export async function updateDraft(
  rawInput: UpdateDraftInput,
): Promise<MetaRuleDraft> {
  const input = updateDraftInputSchema.parse(rawInput);
  const row = await patchDraft(input.draftId, input.patch as Partial<DraftCore>);
  await recordAudit(
    {
      connectionId: input.connectionId,
      operationType: 'rule.draft.update',
      targetType: 'rule_draft',
      targetId: row.id,
      actorId: input.actorId ?? null,
      requestBody: { fields: Object.keys(input.patch) },
    },
    { status: 'success', durationMs: 0 },
  );
  return row;
}

export async function discardDraft(
  rawInput: DiscardDraftInput,
): Promise<MetaRuleDraft> {
  const input = discardDraftInputSchema.parse(rawInput);
  const row = await markDraftDiscarded(input.draftId);
  await recordAudit(
    {
      connectionId: input.connectionId,
      operationType: 'rule.draft.discard',
      targetType: 'rule_draft',
      targetId: row.id,
      actorId: input.actorId ?? null,
    },
    { status: 'success', durationMs: 0 },
  );
  return row;
}

// ---------- Publish & Meta CRUD ----------

export interface PublishDraftResult {
  draft: MetaRuleDraft;
  ruleId: string;
  snapshot: MetaRuleSnapshot;
}

export async function publishDraft(
  rawInput: PublishDraftInput,
): Promise<PublishDraftResult> {
  const input = publishDraftInputSchema.parse(rawInput);
  const draft = await getDraft(input.draftId);
  if (!draft) throw new Error(`Draft ${input.draftId} not found`);
  if (draft.state !== 'draft') {
    throw new DraftNotEditableError(input.draftId);
  }

  const status: MetaRuleStatus =
    draft.statusIntent === 'enabled' ? 'ENABLED' : 'DISABLED';

  const created = await withAudit(
    {
      connectionId: input.connectionId,
      operationType: 'rule.create',
      targetType: 'rule',
      actorId: input.actorId ?? null,
      requestBody: {
        draftId: draft.id,
        name: draft.name,
        statusIntent: draft.statusIntent,
      },
    },
    () =>
      createRuleAtMeta(input.connectionId, {
        name: draft.name,
        status,
        evaluationSpec: draft.evaluationSpec as EvaluationSpec,
        executionSpec: draft.executionSpec as ExecutionSpec,
        scheduleSpec: (draft.scheduleSpec as ScheduleSpec | null) ?? undefined,
      }),
    (r) => r.id,
  );

  const fetched = await fetchRuleFromMeta(input.connectionId, created.id);
  const snapshot = await saveRuleSnapshot(input.connectionId, fetched);
  const updatedDraft = await markDraftPublished(draft.id, created.id);

  logger.info(
    { draftId: draft.id, ruleId: created.id },
    'Draft published as Meta rule',
  );
  return { draft: updatedDraft, ruleId: created.id, snapshot };
}

export async function updateRule(
  rawInput: UpdateRuleInput,
): Promise<MetaRuleSnapshot> {
  const input = updateRuleInputSchema.parse(rawInput);
  const payload: UpdateRulePayload = {};
  if (input.patch.name !== undefined) payload.name = input.patch.name;
  if (input.patch.evaluationSpec !== undefined) {
    payload.evaluationSpec = input.patch.evaluationSpec;
  }
  if (input.patch.executionSpec !== undefined) {
    payload.executionSpec = input.patch.executionSpec;
  }
  if (input.patch.scheduleSpec !== undefined) {
    payload.scheduleSpec = input.patch.scheduleSpec;
  }

  await withAudit(
    {
      connectionId: input.connectionId,
      operationType: 'rule.update',
      targetType: 'rule',
      targetId: input.ruleId,
      actorId: input.actorId ?? null,
      requestBody: { fields: Object.keys(input.patch), reason: input.reason },
    },
    () => updateRuleAtMeta(input.connectionId, input.ruleId, payload),
  );

  const fetched = await fetchRuleFromMeta(input.connectionId, input.ruleId);
  return saveRuleSnapshot(input.connectionId, fetched);
}

export async function enableRule(
  rawInput: RuleStatusChangeInput,
): Promise<MetaRuleSnapshot> {
  return setStatus(rawInput, 'ENABLED');
}

export async function disableRule(
  rawInput: RuleStatusChangeInput,
): Promise<MetaRuleSnapshot> {
  return setStatus(rawInput, 'DISABLED');
}

async function setStatus(
  rawInput: RuleStatusChangeInput,
  status: 'ENABLED' | 'DISABLED',
): Promise<MetaRuleSnapshot> {
  const input = ruleStatusChangeInputSchema.parse(rawInput);
  const op = status === 'ENABLED' ? 'rule.enable' : 'rule.disable';

  await withAudit(
    {
      connectionId: input.connectionId,
      operationType: op,
      targetType: 'rule',
      targetId: input.ruleId,
      actorId: input.actorId ?? null,
      requestBody: { status, reason: input.reason },
    },
    () => setRuleStatusAtMeta(input.connectionId, input.ruleId, status),
  );

  const fetched = await fetchRuleFromMeta(input.connectionId, input.ruleId);
  return saveRuleSnapshot(input.connectionId, fetched);
}

export async function deleteRule(
  rawInput: DeleteRuleInput,
): Promise<MetaRuleSnapshot> {
  const input = deleteRuleInputSchema.parse(rawInput);
  const previous = await findLatestSnapshot(input.connectionId, input.ruleId);

  await withAudit(
    {
      connectionId: input.connectionId,
      operationType: 'rule.delete',
      targetType: 'rule',
      targetId: input.ruleId,
      actorId: input.actorId ?? null,
      requestBody: { reason: input.reason },
    },
    () => deleteRuleAtMeta(input.connectionId, input.ruleId),
  );

  return saveDeletedRuleSnapshot(input.connectionId, input.ruleId, previous);
}

// ---------- Reads ----------

export async function refreshSnapshot(
  rawInput: RefreshRuleInput,
): Promise<MetaRuleSnapshot> {
  const input = refreshRuleInputSchema.parse(rawInput);
  const fetched = await fetchRuleFromMeta(input.connectionId, input.ruleId);
  return saveRuleSnapshot(input.connectionId, fetched);
}

export async function describeRule(
  connectionId: string,
  ruleId: string,
): Promise<ReadableRule | null> {
  const snap = await findLatestSnapshot(connectionId, ruleId);
  if (!snap) return null;
  const parsed = parseSnapshot(snap);
  return formatRule({
    name: snap.name,
    status: snap.status as MetaRuleStatus,
    evaluationSpec: parsed.evaluationSpec,
    executionSpec: parsed.executionSpec,
    scheduleSpec: parsed.scheduleSpec,
  });
}

export async function listRules(
  connectionId: string,
): Promise<Array<{ snapshot: MetaRuleSnapshot; readable: ReadableRule }>> {
  const snapshots = await listLatestSnapshots(connectionId);
  return snapshots.map((s) => {
    const p = parseSnapshot(s);
    return {
      snapshot: s,
      readable: formatRule({
        name: s.name,
        status: s.status as MetaRuleStatus,
        evaluationSpec: p.evaluationSpec,
        executionSpec: p.executionSpec,
        scheduleSpec: p.scheduleSpec,
      }),
    };
  });
}
