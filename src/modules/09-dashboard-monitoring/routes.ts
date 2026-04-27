import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../../config/env.js';
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
import { renderSettings } from './views/settings.js';
import {
  activitySummary,
  addKieCredential,
  addMetaConnection,
  assetCounts,
  campaignDetail,
  listCampaigns,
  listKieCredentials,
  listMetaConnections,
  listRecentAssets,
  recentAudits,
  setKieCredentialKey,
  setMetaConnectionName,
  setMetaConnectionToken,
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

  app.get('/creatives', auth, async (req: SessionRequest, reply) => {
    const session = req.dashboardSession;
    if (!session) return;
    const [assets, counts] = await Promise.all([
      listRecentAssets(50),
      assetCounts(),
    ]);
    reply.type('text/html').send(
      renderCreatives({ username: session.username, assets, counts }),
    );
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
