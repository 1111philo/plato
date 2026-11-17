/**
 * The Microsoft Entra ID sign-in provider (single tenant). Core runs the
 * OpenID Connect flow and owns accounts and sessions (server/src/lib/oidc.js,
 * external-identity.js); this file only says where the tenant is and what its
 * ID token means.
 *
 * Trust settings come from the deployment's environment, never from plugin
 * settings: an admin account must not be able to point sign-in at another
 * tenant. See docs/SSO.md.
 *   SSO_ENTRA_TENANT_ID      directory (tenant) id, a GUID
 *   SSO_ENTRA_CLIENT_ID      application (client) id
 *   SSO_ENTRA_CLIENT_SECRET  client secret value
 *   SSO_ENTRA_DOMAINS        email domains the tenant owns, e.g. "uic.edu"
 *   SSO_ENTRA_AUTHORITY      (tests only) replaces https://login.microsoftonline.com
 */
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const refuse = (message) => Object.assign(new Error(message), { code: 'identity_refused' });

export function configure(env = process.env, settings = {}) {
  const tenant = (env.SSO_ENTRA_TENANT_ID || '').trim().toLowerCase();
  const clientId = (env.SSO_ENTRA_CLIENT_ID || '').trim();
  const clientSecret = (env.SSO_ENTRA_CLIENT_SECRET || '').trim();
  // One named tenant only: "common" or "organizations" would accept any Microsoft account.
  if (!GUID.test(tenant) || !clientId || !clientSecret) return null;
  const authority = (env.SSO_ENTRA_AUTHORITY || 'https://login.microsoftonline.com').replace(/\/$/, '');
  return {
    issuer: `${authority}/${tenant}/v2.0`,
    clientId,
    clientSecret,
    scope: 'openid profile email',
    authorizeParams: { prompt: 'select_account' },
    tenant,
    domains: (env.SSO_ENTRA_DOMAINS || '').split(',').map((d) => d.trim().toLowerCase().replace(/^@/, '')).filter(Boolean),
    label: (typeof settings?.buttonLabel === 'string' && settings.buttonLabel.trim()) || 'Sign in with Microsoft',
  };
}

/**
 * Which addresses the tenant vouches for. The `email` claim and the sign-in
 * name (`preferred_username`) are both candidates, since a campus account
 * often has an alias as one and the NetID address as the other. An address
 * counts only when its domain is one the tenant owns (`SSO_ENTRA_DOMAINS`):
 * a guest account's outside address, or anything else in the directory, never
 * matches a plato account. `xms_edov: false` (Entra saying the email's domain
 * owner isn't verified) rules the `email` claim out.
 */
export function mapClaims(claims, cfg) {
  if (String(claims.tid || '').toLowerCase() !== cfg.tenant) throw refuse('token is from another tenant');
  const subject = claims.oid || claims.sub;
  if (!subject) throw refuse('token has no subject');
  const clean = (v) => (typeof v === 'string' && EMAIL.test(v.trim()) ? v.trim().toLowerCase() : null);
  const emailClaim = claims.xms_edov === false ? null : clean(claims.email);
  const candidates = [...new Set([emailClaim, clean(claims.preferred_username)].filter(Boolean))];
  const emails = candidates.filter((e) => cfg.domains.includes(e.split('@')[1]));
  return {
    subject: String(subject),
    tenant: cfg.tenant,
    emails,
    email: emails[0] || candidates[0] || null,
    firstName: typeof claims.given_name === 'string' ? claims.given_name : '',
    lastName: typeof claims.family_name === 'string' ? claims.family_name : '',
    name: typeof claims.name === 'string' ? claims.name : '',
  };
}

export const provider = { id: 'entra', label: (cfg) => cfg.label, configure, mapClaims };
