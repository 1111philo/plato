/**
 * Microsoft Entra SSO plugin — server side. Supplies the `entra` sign-in
 * provider (provider.js) and one admin route that reports whether the
 * deployment has configured it. No secrets are ever returned.
 */
import { Hono, authenticate, requireAdmin, APP_URL } from '../../../src/lib/plugins/sdk.js';
import { configure, provider } from './provider.js';

const routes = new Hono();
routes.use('*', authenticate, requireAdmin);

const mask = (v) => (v ? `${v.slice(0, 4)}…${v.slice(-4)}` : null);

// GET /v1/plugins/entra-sso/admin/status
routes.get('/admin/status', (c) => {
  const cfg = configure();
  return c.json({
    configured: !!cfg,
    tenantId: mask(cfg?.tenant),
    clientId: mask(cfg?.clientId),
    domains: cfg?.domains || [],
    redirectUri: `${APP_URL}/v1/auth/sso/${provider.id}/callback`,
  });
});

export default {
  routes,
  authProviders: [provider],
};
