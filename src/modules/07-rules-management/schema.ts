import { z } from 'zod';

export const ruleStatusSchema = z.enum(['ENABLED', 'DISABLED', 'DELETED']);
export type MetaRuleStatus = z.infer<typeof ruleStatusSchema>;

export const ruleStatusIntentSchema = z.enum(['enabled', 'disabled']);
export type RuleStatusIntent = z.infer<typeof ruleStatusIntentSchema>;

export const ruleDraftStateSchema = z.enum(['draft', 'published', 'discarded']);
export type RuleDraftState = z.infer<typeof ruleDraftStateSchema>;

export const filterOperatorSchema = z.enum([
  'GREATER_THAN',
  'LESS_THAN',
  'EQUAL',
  'NOT_EQUAL',
  'GREATER_THAN_OR_EQUAL',
  'LESS_THAN_OR_EQUAL',
  'IN_RANGE',
  'NOT_IN_RANGE',
  'IN',
  'NOT_IN',
  'CONTAIN',
  'NOT_CONTAIN',
]);
export type FilterOperator = z.infer<typeof filterOperatorSchema>;

const filterValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.union([z.string(), z.number()])),
]);

export const ruleFilterSchema = z.object({
  field: z.string().min(1),
  operator: filterOperatorSchema,
  value: filterValueSchema,
  /** Optional Meta time-window string (e.g. "last_7d", "lifetime"). */
  time_preset: z.string().optional(),
});
export type RuleFilter = z.infer<typeof ruleFilterSchema>;

export const evaluationSpecSchema = z.object({
  evaluation_type: z.enum(['SCHEDULE', 'TRIGGER']),
  filters: z.array(ruleFilterSchema),
  trigger: z.record(z.unknown()).optional(),
});
export type EvaluationSpec = z.infer<typeof evaluationSpecSchema>;

export const executionSpecSchema = z.object({
  execution_type: z.string().min(1),
  execution_options: z.array(z.record(z.unknown())).optional(),
});
export type ExecutionSpec = z.infer<typeof executionSpecSchema>;

export const scheduleSpecSchema = z.object({
  schedule_type: z.string().min(1),
  schedules: z.array(z.record(z.unknown())).optional(),
});
export type ScheduleSpec = z.infer<typeof scheduleSpecSchema>;

const draftCore = z.object({
  name: z.string().min(1).max(255),
  statusIntent: ruleStatusIntentSchema.default('disabled'),
  evaluationSpec: evaluationSpecSchema,
  executionSpec: executionSpecSchema,
  scheduleSpec: scheduleSpecSchema.optional(),
  notes: z.string().max(2000).optional(),
});

export const createDraftInputSchema = z.object({
  connectionId: z.string().uuid(),
  actorId: z.string().min(1).optional(),
  draft: draftCore,
});
export type CreateDraftInput = z.infer<typeof createDraftInputSchema>;

export const updateDraftInputSchema = z.object({
  connectionId: z.string().uuid(),
  actorId: z.string().min(1).optional(),
  draftId: z.string().uuid(),
  patch: draftCore.partial(),
});
export type UpdateDraftInput = z.infer<typeof updateDraftInputSchema>;

export const discardDraftInputSchema = z.object({
  connectionId: z.string().uuid(),
  actorId: z.string().min(1).optional(),
  draftId: z.string().uuid(),
});
export type DiscardDraftInput = z.infer<typeof discardDraftInputSchema>;

export const publishDraftInputSchema = discardDraftInputSchema;
export type PublishDraftInput = z.infer<typeof publishDraftInputSchema>;

export const updateRuleInputSchema = z.object({
  connectionId: z.string().uuid(),
  actorId: z.string().min(1).optional(),
  ruleId: z.string().min(1),
  reason: z.string().min(3),
  patch: z.object({
    name: z.string().min(1).optional(),
    evaluationSpec: evaluationSpecSchema.optional(),
    executionSpec: executionSpecSchema.optional(),
    scheduleSpec: scheduleSpecSchema.optional(),
  }),
});
export type UpdateRuleInput = z.infer<typeof updateRuleInputSchema>;

export const ruleStatusChangeInputSchema = z.object({
  connectionId: z.string().uuid(),
  actorId: z.string().min(1).optional(),
  ruleId: z.string().min(1),
  reason: z.string().min(3),
});
export type RuleStatusChangeInput = z.infer<typeof ruleStatusChangeInputSchema>;

export const deleteRuleInputSchema = ruleStatusChangeInputSchema;
export type DeleteRuleInput = z.infer<typeof deleteRuleInputSchema>;

export const refreshRuleInputSchema = z.object({
  connectionId: z.string().uuid(),
  ruleId: z.string().min(1),
});
export type RefreshRuleInput = z.infer<typeof refreshRuleInputSchema>;
