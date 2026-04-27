import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { appConfig as config } from '../00-foundation/index.js';
import {
  clearSessionCookie,
  createSessionCookie,
  readSession,
  requireAuth,
  verifyCredentials,
  type DashboardSession,
} from './auth.js';
import { renderLogin, renderDashboardOffline } from './views/login.js';
import { renderHome } from './views/home.js';
import { renderCampaigns } from './views/campaigns.js';
import { renderCampaignDetail } from './views/campaign-detail.js';
import { renderCreatives } from './views/creatives.js';
import { renderAudiences } from './views/audiences.js';
import { renderWorkflows } from './views/workflows.js';
import { renderSettings } from './views/settings.js';
import {
  activitySummary,
  addKieCredential,
  addMetaConnection,
  assetCounts,
  campaignDetail,
  cronJobsStatus,
  listAssetsFiltered,
  listAudiences,
  listCampaigns,
  listKieCredentials,
  listMetaConnections,
  recentAudits,
  setKieCredentialKey,
  setMetaConnectionName,
  setMetaConnectionToken,
  workflowComponents,
  type AssetStatusFilter,
  type AssetTypeFilter,
} from './data.js';

type SessionRequest = FastifyRequest & { dashboardSession?: DashboardSession };

export const dashboardRoutes: FastifyPluginAsync = async (app) => {
  if (!config.dashboard.isConfigured) {
    app.log.warn(
      'Dashboard skipped: set DASHBOARD_PASSWORD and DASHBOARD_SESSION_SECRET to enable.',
    );
    app.get('/login', async (_req, reply) => {
      reply.type('text/html').send(renderDashboardOffline());
    });
    return;
  }

  // Form-urlencoded body parser, scoped to this plugin instance.
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_req, body, done) => {
      try {
        const params = new URLSearchParams(body as string);
        const obj: Record<string, string> = {};
        for (const [k, v] of params) obj[k] = v;
        done(null, obj);
      } catch (e) {
        done(e as Error);
      }
    },
  );

  // ---------- Auth ----------

  app.get('/login', async (req, reply) => {
    const existing = readSession(req);
    if (existing) {
      reply.code(302).header('Location', '/').send();
      return;
    }
    reply.type('text/html').send(renderLogin({}));
  });

  app.post('/login', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, string>;
    const username = (body.username ?? '').trim();
    const password = body.password ?? '';
    if (!verifyCredentials(username, password)) {
      reply
        .code(401)
        .type('text/html')
        .send(renderLogin({ error: 'Invalid username or password.' }));
      return;
    }
    reply
      .header('Set-Cookie', createSessionCookie(username))
      .code(302)
      .header('Location', '/')
      .send();
  });

  app.post('/logout', async (_req, reply) => {
    reply
      .header('Set-Cookie', clearSessionCookie())
      .code(302)
      .header('Location', '/login')
      .send();
  });

  // ---------- Protected ----------

  const auth = { preHandler: requireAuth };

  app.get('/', auth, async (req: SessionRequest, reply) => {
    const session = req.dashboardSession;
    if (!session) return; // requireAuth already redirected
    const [conns, kie, audits, activity] = await Promise.all([
      listMetaConnections(),
      listKieCredentials(),
      recentAudits(25),
      activitySummary(),
    ]);
    reply.type('text/html').send(
      renderHome({
        username: session.username,
        metaConnections: conns,
        kieCredentials: kie,
        recentAudits: audits,
        activity,
      }),
    );
  });

  app.get('/campaigns', auth, async (req: SessionRequest, reply) => {
    const session = req.dashboardSession;
    if (!session) return;
    const campaigns = await listCampaigns();
    reply.type('text/html').send(
      renderCampaigns({ username: session.username, campaigns }),
    );
  });

  app.get<{ Params: { id: string } }>(
    '/campaigns/:id',
    auth,
    async (req, reply) => {
      const session = (req as SessionRequest).dashboardSession;
      if (!session) return;
      const detail = await campaignDetail(req.params.id);
      reply.type('text/html').send(
        renderCampaignDetail({
          username: session.username,
          campaignId: req.params.id,
          detail,
        }),
      );
    },
  );

  app.get<{
    Querystring: {
      type?: string;
      status?: string;
      connectionId?: string;
      page?: string;
    };
  }>('/creatives', auth, async (req, reply) => {
    const session = (req as SessionRequest).dashboardSession;
    if (!session) return;
    const type = parseTypeFilter(req.query.type);
    const status = parseStatusFilter(req.query.status);
    const connectionId = (req.query.connectionId ?? '').trim();
    const page = parsePositiveInt(req.query.page, 1);
    const [assets, counts, connections] = await Promise.all([
      listAssetsFiltered({
        type,
        status,
        connectionId: connectionId || undefined,
        page,
        pageSize: 20,
      }),
      assetCounts(),
      listMetaConnections(),
    ]);
    reply.type('text/html').send(
      renderCreatives({
        username: session.username,
        assets,
        counts,
        connections,
        filters: { type, status, connectionId },
      }),
    );
  });

  app.get<{ Querystring: { connectionId?: string } }>(
    '/audiences',
    auth,
    async (req, reply) => {
      const session = (req as SessionRequest).dashboardSession;
      if (!session) return;
      const connectionId = (req.query.connectionId ?? '').trim();
      const [result, connections] = await Promise.all([
        listAudiences(connectionId || undefined),
        listMetaConnections(),
      ]);
      reply.type('text/html').send(
        renderAudiences({
          username: session.username,
          result,
          connections,
          filterConnectionId: connectionId,
        }),
      );
    },
  );

  app.get('/workflows', auth, async (req: SessionRequest, reply) => {
    const session = req.dashboardSession;
    if (!session) return;
    const [components, cronJobs] = await Promise.all([
      workflowComponents(),
      cronJobsStatus(),
    ]);
    reply
      .type('text/html')
      .send(renderWorkflows({ username: session.username, components, cronJobs }));
  });

  app.get<{ Querystring: { ok?: string; err?: string } }>(
    '/settings',
    auth,
    async (req, reply) => {
      const session = (req as SessionRequest).dashboardSession;
      if (!session) return;
      await renderSettingsPage(reply, session.username, req.query.ok, req.query.err);
    },
  );

  app.post('/settings/meta', auth, async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, string>;
    const accountName = (body.accountName ?? '').trim();
    const adAccountId = (body.adAccountId ?? '').trim();
    const accessToken = body.accessToken ?? '';
    if (!accountName || !adAccountId || !accessToken) {
      return redirectSettings(reply, { err: 'All fields are required.' });
    }
    if (!/^\d+$/.test(adAccountId)) {
      return redirectSettings(reply, {
        err: 'Ad account ID must contain digits only.',
      });
    }
    try {
      await addMetaConnection({ accountName, adAccountId, accessToken });
      return redirectSettings(reply, { ok: 'Account added.' });
    } catch (err) {
      app.log.error({ err }, 'Failed to add Meta connection');
      return redirectSettings(reply, { err: 'Could not save the account.' });
    }
  });

  app.post('/settings/meta/replace', auth, async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, string>;
    const connectionId = (body.connectionId ?? '').trim();
    const accessToken = body.accessToken ?? '';
    if (!connectionId || !accessToken) {
      return redirectSettings(reply, { err: 'Missing fields.' });
    }
    try {
      await setMetaConnectionToken(connectionId, accessToken);
      return redirectSettings(reply, { ok: 'Token replaced.' });
    } catch (err) {
      app.log.error({ err, connectionId }, 'Failed to replace Meta token');
      return redirectSettings(reply, { err: 'Could not replace the token.' });
    }
  });

  app.post('/settings/meta/rename', auth, async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, string>;
    const connectionId = (body.connectionId ?? '').trim();
    const accountName = (body.accountName ?? '').trim();
    if (!connectionId || !accountName) {
      return redirectSettings(reply, { err: 'Missing fields.' });
    }
    if (accountName.length > 200) {
      return redirectSettings(reply, { err: 'Name too long (max 200 chars).' });
    }
    try {
      await setMetaConnectionName(connectionId, accountName);
      return redirectSettings(reply, { ok: 'Account name updated.' });
    } catch (err) {
      app.log.error({ err, connectionId }, 'Failed to rename Meta account');
      return redirectSettings(reply, { err: 'Could not rename the account.' });
    }
  });

  app.post('/settings/kie', auth, async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, string>;
    const label = (body.label ?? '').trim();
    const apiKey = body.apiKey ?? '';
    if (!label || !apiKey) {
      return redirectSettings(reply, { err: 'All fields are required.' });
    }
    try {
      await addKieCredential({ label, apiKey });
      return redirectSettings(reply, { ok: 'Image key added.' });
    } catch (err) {
      app.log.error({ err }, 'Failed to add KIE credential');
      return redirectSettings(reply, { err: 'Could not save the key.' });
    }
  });

  app.post('/settings/kie/replace', auth, async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, string>;
    const credentialId = (body.credentialId ?? '').trim();
    const apiKey = body.apiKey ?? '';
    if (!credentialId || !apiKey) {
      return redirectSettings(reply, { err: 'Missing fields.' });
    }
    try {
      await setKieCredentialKey(credentialId, apiKey);
      return redirectSettings(reply, { ok: 'Image key replaced.' });
    } catch (err) {
      app.log.error({ err, credentialId }, 'Failed to replace KIE key');
      return redirectSettings(reply, { err: 'Could not replace the key.' });
    }
  });
};

async function renderSettingsPage(
  reply: FastifyReply,
  username: string,
  ok?: string,
  err?: string,
): Promise<void> {
  const [conns, kie] = await Promise.all([
    listMetaConnections(),
    listKieCredentials(),
  ]);
  const flash =
    ok != null
      ? ({ kind: 'success', message: ok } as const)
      : err != null
        ? ({ kind: 'error', message: err } as const)
        : null;
  reply.type('text/html').send(
    renderSettings({
      username,
      metaConnections: conns,
      kieCredentials: kie,
      flash,
    }),
  );
}

function parseTypeFilter(v: string | undefined): AssetTypeFilter {
  if (v === 'image' || v === 'video') return v;
  return 'all';
}

function parseStatusFilter(v: string | undefined): AssetStatusFilter {
  if (
    v === 'success' ||
    v === 'failed' ||
    v === 'in_progress' ||
    v === 'expired'
  )
    return v;
  return 'all';
}

function parsePositiveInt(v: string | undefined, fallback: number): number {
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return n;
}

function redirectSettings(
  reply: FastifyReply,
  flash: { ok?: string; err?: string },
): FastifyReply {
  const params = new URLSearchParams();
  if (flash.ok) params.set('ok', flash.ok);
  if (flash.err) params.set('err', flash.err);
  const qs = params.toString();
  return reply.code(302).header('Location', `/settings${qs ? `?${qs}` : ''}`).send();
}
