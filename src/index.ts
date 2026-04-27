import { buildServer } from './server.js';
import {
  appConfig as config,
  closeDb,
  jobDispatcher,
  logger,
  pingDb,
} from './modules/00-foundation/index.js';
import { startBot, stopBot } from './modules/10-telegram-bot/index.js';

async function main(): Promise<void> {
  await pingDb().catch((err) => {
    logger.fatal({ err }, 'Database unreachable on startup');
    throw err;
  });

  // pg-boss bootstrap — best-effort, gagal di sini tidak block server boot.
  // Saat ini belum ada job/worker yang di-register di main; bootstrap dini
  // memastikan schema `pgboss` siap saat helper pertama dipanggil dari
  // modul yang butuh (mis. KIE.ai task polling). Lihat
  // 00-foundation/job-dispatcher.ts untuk API.
  jobDispatcher
    .bootstrap()
    .then(() => logger.info('pg-boss bootstrap complete'))
    .catch((err) => {
      logger.error({ err }, 'pg-boss bootstrap failed (non-fatal)');
    });

  const app = await buildServer();
  await startBot();

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutdown initiated');
    try {
      await stopBot(signal);
      await app.close();
      await jobDispatcher.shutdown();
      await closeDb();
      logger.info('Shutdown complete');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled promise rejection');
  });
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught exception');
    void shutdown('uncaughtException');
  });

  await app.listen({ host: config.host, port: config.port });
  logger.info(
    { host: config.host, port: config.port, env: config.nodeEnv },
    'meta-ads server listening',
  );
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start server');
  process.exit(1);
});
