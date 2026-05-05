import { authenticatedFetch } from '../../../client/js/auth.js';
import { createPkceChallenge, createPkceVerifier } from './pkce.js';

export async function startOpenRouterClaim({
  createVerifier = createPkceVerifier,
  createChallenge = createPkceChallenge,
  fetcher = authenticatedFetch,
  storage = globalThis.sessionStorage,
  assign = (url) => globalThis.window.location.assign(url),
} = {}) {
  const verifier = createVerifier();
  const codeChallenge = await createChallenge(verifier);
  const res = await fetcher('/v1/plugins/openrouter-rewards/oauth/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ codeChallenge }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not start OpenRouter sign-in');
  storage.setItem(`or-pkce-verifier:${data.state}`, verifier);
  assign(data.authorizationUrl);
  return data;
}
