import Fastify, {
  type FastifyInstance,
  type FastifyBaseLogger,
  type FastifyError,
} from 'fastify';
import sensible from '@fastify/sensible';
import { logger } from './lib/logger.js';
import { healthRoutes } from './routes/health.js';
import { TokenInvalidError } from './lib/auth-manager.js';
import { dashboardRoutes } from './modules/09-dashboard-monitoring/index.js';
import { KieCredentialError } from './modules/05-kie-image-generator/kie-credentials.js';

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: logger as unknown as FastifyBaseLogger,
    disableRequestLogging: false,
    bodyLimit: 4 * 1024 * 1024,
    trustProxy: true,
    ajv: { customOptions: { removeAdditional: 'all', useDefaults: true } },
  });

  await app.register(sensible);
  await app.register(healthRoutes);
  await app.register(dashboardRoutes);

  app.setErrorHandler((err: FastifyError, _req, reply) => {
    if (err instanceof TokenInvalidError) {
      reply.code(503);
      return {
        error: 'token_invalid',
        connectionId: err.connectionId,
        reason: err.reason,
        message: 'Meta token is invalid. System halted — owner must replace token.',
      };
    }

    if (err instanceof KieCredentialError) {
      reply.code(503);
      return {
        error: 'kie_credential',
        reason: err.reason,
        credentialId: err.credentialId,
        message: err.message,
      };
    }

    if (err.statusCode && err.statusCode < 500) {
      reply.code(err.statusCode);
      return { error: err.code ?? 'request_error', message: err.message };
    }

    app.log.error({ err }, 'Unhandled request error');
    reply.code(500);
    return { error: 'internal_error', message: 'Internal server error' };
  });

  return app;
}
