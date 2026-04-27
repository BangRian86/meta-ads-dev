import type { FastifyPluginAsync } from 'fastify';
import { pingDb } from '../db/index.js';

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', async () => ({ status: 'ok', ts: new Date().toISOString() }));

  app.get('/health/db', async (_req, reply) => {
    try {
      await pingDb();
      return { status: 'ok', db: 'connected' };
    } catch (err) {
      app.log.error({ err }, 'DB healthcheck failed');
      reply.code(503);
      return {
        status: 'down',
        db: 'disconnected',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });
};
