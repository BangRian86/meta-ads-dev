import type {
  EvaluationSpec,
  ExecutionSpec,
  RuleFilter,
  ScheduleSpec,
  MetaRuleStatus,
} from './schema.js';

const FIELD_LABELS: Record<string, string> = {
  spend: 'Spend',
  impressions: 'Impressions',
  reach: 'Reach',
  clicks: 'Clicks',
  ctr: 'CTR',
  cpc: 'CPC',
  cpm: 'CPM',
  frequency: 'Frequency',
  cost_per_action_type: 'Cost per result',
  actions: 'Results',
  conversion_rate_ranking: 'Conversion-rate ranking',
  quality_ranking: 'Quality ranking',
  engagement_rate_ranking: 'Engagement-rate ranking',
};

const OPERATOR_TEXT: Record<string, string> = {
  GREATER_THAN: '>',
  LESS_THAN: '<',
  EQUAL: '=',
  NOT_EQUAL: '!=',
  GREATER_THAN_OR_EQUAL: '>=',
  LESS_THAN_OR_EQUAL: '<=',
  IN_RANGE: 'in range',
  NOT_IN_RANGE: 'not in range',
  IN: 'in',
  NOT_IN: 'not in',
  CONTAIN: 'contains',
  NOT_CONTAIN: 'does not contain',
};

export interface ReadableRule {
  title: string;
  status: MetaRuleStatus;
  conditions: string[];
  action: string;
  schedule: string;
  text: string;
}

export function formatRule(input: {
  name: string;
  status: MetaRuleStatus;
  evaluationSpec: EvaluationSpec;
  executionSpec: ExecutionSpec;
  scheduleSpec: ScheduleSpec | null;
}): ReadableRule {
  const conditions = input.evaluationSpec.filters.map(formatFilter);
  const action = formatExecution(input.executionSpec);
  const schedule = formatSchedule(input.scheduleSpec, input.evaluationSpec.evaluation_type);

  const lines: string[] = [];
  lines.push(`Rule: "${input.name}"`);
  lines.push(`Status: ${input.status}`);
  lines.push(`Trigger type: ${input.evaluationSpec.evaluation_type}`);
  if (conditions.length > 0) {
    lines.push('When ALL of:');
    for (const c of conditions) lines.push(`  - ${c}`);
  } else {
    lines.push('When: (no conditions)');
  }
  lines.push(`Then: ${action}`);
  lines.push(`Schedule: ${schedule}`);

  return {
    title: input.name,
    status: input.status,
    conditions,
    action,
    schedule,
    text: lines.join('\n'),
  };
}

function formatFilter(f: RuleFilter): string {
  const label = FIELD_LABELS[f.field] ?? f.field;
  const op = OPERATOR_TEXT[f.operator] ?? f.operator;
  const value = formatValue(f.value);
  const window = f.time_preset ? ` (${f.time_preset.replace(/_/g, ' ')})` : '';
  return `${label} ${op} ${value}${window}`;
}

function formatValue(v: RuleFilter['value']): string {
  if (Array.isArray(v)) return `[${v.join(', ')}]`;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return JSON.stringify(v);
}

function formatExecution(spec: ExecutionSpec): string {
  const t = spec.execution_type.toUpperCase();
  switch (t) {
    case 'PAUSE':
      return 'PAUSE matched objects';
    case 'UNPAUSE':
      return 'UNPAUSE matched objects';
    case 'NOTIFICATION':
      return 'Send a notification';
    case 'CHANGE_BUDGET':
      return `Change budget (options: ${describeOptions(spec.execution_options)})`;
    case 'REBALANCE_BUDGET':
      return 'Rebalance budget across active ad sets';
    case 'ROTATE':
      return 'Rotate creatives';
    default:
      return `Action: ${spec.execution_type}`;
  }
}

function describeOptions(opts: ExecutionSpec['execution_options']): string {
  if (!opts || opts.length === 0) return 'default';
  return opts
    .map((o) => {
      const entries = Object.entries(o);
      return entries.map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ');
    })
    .join(' | ');
}

function formatSchedule(
  spec: ScheduleSpec | null,
  evaluationType: EvaluationSpec['evaluation_type'],
): string {
  if (evaluationType === 'TRIGGER') return 'on every trigger event';
  if (!spec) return 'default (per Meta evaluation cadence)';
  const type = spec.schedule_type.toUpperCase();
  if (type === 'SEMI_HOURLY') return 'every 30 minutes';
  if (type === 'DAILY') return 'once per day';
  if (type === 'CUSTOM') {
    const count = spec.schedules?.length ?? 0;
    return `custom (${count} window${count === 1 ? '' : 's'})`;
  }
  return type.toLowerCase();
}
