// Single sign-on, app side (docs/SSO.md): the provider buttons, the words for
// each failure, and the one-time-code exchange. The server decides everything
// about accounts; this only starts the flow and shows what came back.

/** The providers to show a button for: `[{ id, label }]`, empty when SSO is off. */
export async function fetchSsoProviders() {
  try {
    const res = await fetch('/v1/auth/sso/providers');
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.providers) ? data.providers.filter((p) => p?.id && p?.label) : [];
  } catch {
    return [];
  }
}

/**
 * The provider's name out of its button label: "Sign in with UIC" → "UIC".
 * A label that isn't shaped like that is used whole.
 */
export function providerName(label) {
  const text = typeof label === 'string' ? label.trim() : '';
  const name = text.replace(/^(sign in|log in|login|continue|sign up) (with|using|via) /i, '').trim();
  return name || text || 'single sign-on';
}

/** Where a provider button goes: a full-page navigation, not a fetch. */
export function ssoStartUrl(providerId, { next, invite } = {}) {
  const params = new URLSearchParams();
  // Only a local path is worth sending; the server turns anything else into "/".
  if (typeof next === 'string' && next.startsWith('/') && !next.startsWith('//')) params.set('next', next);
  if (invite) params.set('invite', invite);
  const query = params.toString();
  return `/v1/auth/sso/${encodeURIComponent(providerId)}/start${query ? `?${query}` : ''}`;
}

/** The one-time code from `/sso/complete#code=…`, or null. */
export function ssoCodeFromHash(hash) {
  const code = new URLSearchParams(String(hash || '').replace(/^#/, '')).get('code');
  return code && /^[A-Za-z0-9_-]{8,200}$/.test(code) ? code : null;
}

const SSO_REASONS = ['cancelled', 'expired', 'refused', 'failed', 'unavailable'];

/**
 * The message for `/login?sso=<reason>`, or '' for no (or an unknown) reason.
 * `providers` is the live list: with exactly one, it's named.
 */
export function ssoReasonMessage(reason, providers = []) {
  if (!SSO_REASONS.includes(reason)) return '';
  const name = providers.length === 1 ? providerName(providers[0].label) : 'single sign-on';
  if (reason === 'cancelled') return 'Sign-in was cancelled.';
  if (reason === 'expired') return 'That sign-in took too long. Please try again.';
  if (reason === 'unavailable') {
    return `${name === 'single sign-on' ? 'Single sign-on' : `Signing in with ${name}`} isn’t available right now.`;
  }
  return `We couldn’t sign you in with ${name}. Try again, or use your email and password.`;
}

/** The message for an `{ outcome: 'error', code }` exchange result. */
export function ssoErrorMessage(code, label) {
  const name = providerName(label);
  switch (code) {
    case 'account_has_identity':
      return `This account is already connected to a different ${name} identity. Sign in with your password, or ask your program team.`;
    case 'identity_in_use':
      return `That ${name} account is already connected to another plato account.`;
    case 'invite_invalid':
      return 'This invite can’t be used. If you were invited at a different email, open the link in that invite email.';
    case 'invite_full':
      return 'This invite link has reached its limit.';
    case 'account_exists':
      return `An account already exists for that email. Sign in with your password, then connect ${name} in Settings.`;
    default:
      return 'Something went wrong signing you in. Please try again.';
  }
}

export const SSO_EXPIRED_MESSAGE = 'That sign-in link has expired. Please try again.';

// One exchange per code, however many times the page's effect runs (React
// StrictMode mounts twice; the code is single-use, so a second POST would
// fail and overwrite the first one's result).
const exchanges = new Map();

/**
 * Trade the one-time code for the outcome. Resolves to the server's outcome
 * object, or `{ outcome: 'expired' }` for a used / expired code, a missing
 * cookie, or a network failure. The transaction cookie rides along
 * (same-origin).
 */
export function exchangeSsoCode(code, fetchImpl = fetch, accessToken = null) {
  if (!exchanges.has(code)) {
    exchanges.set(code, (async () => {
      try {
        const res = await fetchImpl('/v1/auth/sso/exchange', {
          method: 'POST',
          // The session, when there is one: "Connect" from Settings is only
          // finished for the signed-in person who started it.
          headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
          credentials: 'same-origin',
          body: JSON.stringify({ code }),
        });
        if (!res.ok) return { outcome: 'expired' };
        const data = await res.json();
        return data?.outcome ? data : { outcome: 'expired' };
      } catch {
        return { outcome: 'expired' };
      }
    })());
  }
  return exchanges.get(code);
}

/**
 * A destination on this site, else `fallback`. The server already checks
 * `next` (lib/oidc.js safeNextPath); this is the same check before the
 * browser navigates, since browsers strip tabs and newlines from URLs.
 */
export function localPath(next, fallback = '/lessons', origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost') {
  if (typeof next !== 'string' || !next || next === '/') return fallback;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0020\u007f\\]/.test(next) || !next.startsWith('/') || next.startsWith('//')) return fallback;
  try {
    const url = new URL(next, origin);
    return url.origin === origin ? `${url.pathname}${url.search}${url.hash}` : fallback;
  } catch {
    return fallback;
  }
}
