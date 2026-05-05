import { createHash, randomBytes as nodeRandomBytes } from 'node:crypto';

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function pkceChallengeForVerifier(verifier) {
  return base64url(createHash('sha256').update(verifier).digest());
}

export function buildOauthSession(state, { codeChallenge, now = new Date(), randomBytes = nodeRandomBytes }) {
  if (!state.pendingClaim?.claimFingerprint) throw new Error('pending claim required');
  if (!codeChallenge || typeof codeChallenge !== 'string') throw new Error('codeChallenge required');
  const rawState = randomBytes(32).toString('base64url');
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + 10 * 60 * 1000).toISOString();
  const session = {
    stateHash: sha256(rawState),
    codeChallenge,
    claimFingerprint: state.pendingClaim.claimFingerprint,
    createdAt,
    expiresAt,
  };
  return {
    state: rawState,
    nextState: {
      ...state,
      oauthSessions: [...(state.oauthSessions || []).filter((s) => new Date(s.expiresAt) > now).slice(-2), session],
    },
  };
}

export function consumeOauthSession(state, { state: rawState, codeVerifier, now = new Date() }) {
  const stateHash = sha256(rawState || '');
  const idx = (state.oauthSessions || []).findIndex((session) => session.stateHash === stateHash);
  if (idx < 0) throw new Error('OAuth state not found');
  const session = state.oauthSessions[idx];
  if (new Date(session.expiresAt) <= now) throw new Error('OAuth state expired');
  if (session.codeChallenge !== pkceChallengeForVerifier(codeVerifier || '')) throw new Error('PKCE verifier mismatch');
  if (session.claimFingerprint !== state.pendingClaim?.claimFingerprint) throw new Error('pending claim changed');
  return {
    session,
    nextState: {
      ...state,
      oauthSessions: state.oauthSessions.filter((_, i) => i !== idx),
    },
  };
}

export function buildAuthorizationUrl({ state, codeChallenge, callbackUrl }) {
  const url = new URL('https://openrouter.ai/auth');
  url.searchParams.set('callback_url', callbackUrl);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  return url.toString();
}
