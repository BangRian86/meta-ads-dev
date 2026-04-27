import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  integer,
  index,
  pgEnum,
} from 'drizzle-orm/pg-core';

export const kieTaskStatusEnum = pgEnum('kie_task_status', [
  'queued',
  'in_progress',
  'succeeded',
  'failed',
  'expired',
]);

/**
 * Tracking table untuk async tasks ke KIE.ai (image gen, video gen, dll).
 * Beda dari kie_credentials (yang simpan API token); tabel ini track
 * lifecycle individual task: input prompt, output URL, credit usage,
 * polling state.
 *
 * Workflow umum:
 *   1. Caller insert row dengan status='queued', input_payload berisi
 *      prompt + provider params.
 *   2. Worker (via job-dispatcher) ambil row, POST ke KIE.ai, update
 *      status='in_progress' + provider task ID di output_payload.
 *   3. Polling worker check status, kalau done → output_payload diisi
 *      asset URL + credits_used, status='succeeded'.
 *   4. Row expired kalau lewat expires_at (auto-cleanup retention).
 */
export const kieTasks = pgTable(
  'kie_tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Tipe task, e.g. 'image.generate', 'video.generate'. Free-form
     *  string supaya bisa tambah task type baru tanpa migrasi enum. */
    taskType: text('task_type').notNull(),
    status: kieTaskStatusEnum('status').notNull().default('queued'),
    /** Provider sub-identifier — KIE.ai punya multiple provider backend
     *  (Veo, Runway, Sora). Track buat per-provider analytics. */
    provider: text('provider'),
    /** Input prompt + params (model, aspect ratio, duration, dll). */
    inputPayload: jsonb('input_payload').notNull(),
    /** Hasil — provider task id, asset URL, error message. */
    outputPayload: jsonb('output_payload'),
    /** Credit/token consumed per task — billing visibility. */
    creditsUsed: integer('credits_used'),
    /** Caller actor — 'user:<telegram_id>' atau 'cron:<cron_name>'. */
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** TTL — row di-skip / di-cleanup setelah lewat tanggal ini. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (t) => [
    index('kie_tasks_status_idx').on(t.status),
    index('kie_tasks_type_idx').on(t.taskType),
    index('kie_tasks_created_idx').on(t.createdAt),
    index('kie_tasks_expires_idx').on(t.expiresAt),
  ],
);

export type KieTask = typeof kieTasks.$inferSelect;
export type NewKieTask = typeof kieTasks.$inferInsert;
