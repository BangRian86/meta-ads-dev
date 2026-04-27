/**
 * 00-foundation job-dispatcher — pg-boss wrapper untuk background jobs.
 *
 * SCOPE V1 (saat ini):
 * - Lazy init pg-boss instance saat dispatch/register pertama dipanggil.
 * - Helper `dispatch(name, data)` enqueue job ke Postgres-backed queue.
 * - Helper `register(name, handler)` define worker handler.
 * - `startWorker()` / `stopWorker()` lifecycle untuk dipanggil dari main.
 *
 * SCOPE V2 (TODO):
 * - Migrasi cron-based scripts (maa-optimizer, maa-meta-progress, dll)
 *   ke pg-boss schedule API supaya semua background work jalur sama.
 * - Per-job timeout + DLQ + replay UI di dashboard.
 *
 * Saat ini cron tetap di /etc/cron.d/* — pg-boss baru disediakan sebagai
 * infrastructure untuk feature baru (mis. KIE.ai task polling).
 *
 * IMPORTANT: jangan import dari modul lain di file ini sebelum
 * `bootstrap()` dipanggil — boss instance shared singleton.
 */

import PgBoss from 'pg-boss';
import { config } from '../../config/env.js';
import { logger } from './logger.js';

let boss: PgBoss | null = null;
let starting: Promise<PgBoss> | null = null;

/**
 * Lazy-initialize and start pg-boss. Idempotent — multiple callers will
 * await the same in-flight start promise. Caller MUST handle the returned
 * promise (do not fire-and-forget).
 */
export async function bootstrap(): Promise<PgBoss> {
  if (boss) return boss;
  if (starting) return starting;
  starting = (async () => {
    const instance = new PgBoss({
      connectionString: config.databaseUrl,
      // Hide pg-boss internal tables under their own schema so they don't
      // pollute the public namespace (where Drizzle migrations live).
      schema: 'pgboss',
    });
    instance.on('error', (err) => {
      logger.error({ err }, 'pg-boss error');
    });
    await instance.start();
    boss = instance;
    logger.info('pg-boss started');
    return instance;
  })();
  return starting;
}

/**
 * Enqueue a single job. Returns the job id (kalau enqueue berhasil) atau
 * null kalau pg-boss belum bootstrap. Caller decide whether to throw.
 */
export async function dispatch<T extends object>(
  jobName: string,
  data: T,
): Promise<string | null> {
  const b = await bootstrap();
  const id = await b.send(jobName, data);
  return id;
}

/**
 * Register a worker handler. Caller HARUS panggil ini sekali per jobName
 * — pg-boss tidak duplicate-handle. Handler menerima job(s) dan harus
 * return / throw — pg-boss akan retry jika throw.
 */
export async function register<T extends object>(
  jobName: string,
  handler: (job: PgBoss.Job<T>) => Promise<void>,
): Promise<void> {
  const b = await bootstrap();
  await b.work<T>(jobName, async (jobs) => {
    // pg-boss v10 passes an array; default batch size 1 unless configured.
    for (const job of jobs) {
      await handler(job);
    }
  });
}

/**
 * Graceful shutdown — call dari shutdown handler di src/index.ts kalau
 * pg-boss sudah ter-bootstrap. Idempotent.
 */
export async function shutdown(): Promise<void> {
  if (!boss) return;
  await boss.stop({ graceful: true });
  boss = null;
  starting = null;
  logger.info('pg-boss stopped');
}

/** Untuk test / introspection. Returns null kalau belum bootstrap. */
export function getBoss(): PgBoss | null {
  return boss;
}
