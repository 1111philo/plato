/**
 * Sign-in providers. A provider comes from an enabled plugin's server module
 * (`authProviders: [{ id, label, configure(env), mapClaims(claims, cfg) }]`,
 * capability `auth.provider`) and is live only when `configure` returns a
 * config, i.e. when the deployment has supplied its trust settings:
 *
 *   configure(env, pluginSettings) -> null | { issuer, clientId, clientSecret, scope?, authorizeParams? , ... }
 *   mapClaims(claims, cfg) -> { subject, tenant?, emails: [trusted...], email, firstName?, lastName?, name? }
 *     - `emails`: addresses the provider vouches for (used to match accounts,
 *       invites, and wait-list entries). Empty means "match nothing".
 *     - `email`: the address to show and to use for a new account.
 *     - throws (with `.code`) to refuse the sign-in.
 *
 * Plugins never see sessions or user records: core runs the flow
 * (lib/oidc.js), decides the account (lib/external-identity.js), and issues
 * the session (routes/sso.js).
 */
import { pluginRegistry } from './plugins/registry.js';

const ID_RE = /^[a-z][a-z0-9-]{1,30}$/;
let testProviders = null;

/** For tests: replace the plugin-supplied providers. Pass null to restore. */
export function _setProviders(list) { testProviders = list; }

function declared() {
  if (testProviders) return testProviders;
  const out = [];
  for (const entry of pluginRegistry.list()) {
    if (!entry.enabled || entry.loadError) continue;
    const list = entry.serverModule?.authProviders;
    if (!Array.isArray(list)) continue;
    if (!entry.manifest?.capabilities?.includes('auth.provider')) continue;
    for (const p of list) {
      if (p && ID_RE.test(p.id) && typeof p.configure === 'function' && typeof p.mapClaims === 'function') out.push({ ...p, settings: entry.settings || {} });
    }
  }
  return out;
}

/** Live providers: `[{ id, label, cfg, mapClaims }]`. A provider whose configure throws or returns null is off. */
export function liveProviders(env = process.env) {
  const out = [];
  const seen = new Set();
  for (const p of declared()) {
    if (seen.has(p.id)) continue;
    let cfg = null;
    try { cfg = p.configure(env, p.settings || {}); } catch { cfg = null; }
    if (!cfg?.issuer || !cfg.clientId || !cfg.clientSecret) continue;
    seen.add(p.id);
    out.push({ id: p.id, label: typeof p.label === 'function' ? p.label(cfg) : (p.label || p.id), cfg, mapClaims: p.mapClaims });
  }
  return out;
}

export const getProvider = (id, env) => liveProviders(env).find((p) => p.id === id) || null;
