import { buildServer } from './server.js';
import { config } from './config/env.js';
import { logger } from './lib/logger.js';
import { closeDb, pingDb } from './db/index.js';
import { startBot, stopBot } from './modules/10-telegram-bot/index.js';

async function main(): Promise<void> {
  await pingDb().catch((err) => {
    logger.fatal({ err }, 'Database unreachable on startup');
    throw err;
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
