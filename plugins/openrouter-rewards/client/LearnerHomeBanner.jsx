import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { authenticatedFetch } from '../../../client/js/auth.js';

export default function LearnerHomeBanner() {
  const [message, setMessage] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    if (!code || !state) return;

    const verifierKey = `or-pkce-verifier:${state}`;
    const verifier = sessionStorage.getItem(verifierKey);
    sessionStorage.removeItem(verifierKey);
    params.delete('code');
    params.delete('state');
    const nextSearch = params.toString();
    history.replaceState(null, '', `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`);

    if (!verifier) {
      setMessage({ type: 'error', text: 'OpenRouter sign-in expired. Claim again.' });
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await authenticatedFetch('/v1/plugins/openrouter-rewards/claim', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, state, codeVerifier: verifier }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'OpenRouter claim failed');
        if (!cancelled) setMessage({ type: 'success', plaintext: data.plaintext });
      } catch (err) {
        if (!cancelled) setMessage({ type: 'error', text: err.message });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!message) return null;
  return (
    <Card className="mb-3">
      <CardContent className="space-y-2">
        {message.type === 'success' ? (
          <>
            <p className="text-sm">Your OpenRouter key is ready. This key is shown once in plato.</p>
            <code className="block break-all rounded bg-muted p-2 text-xs">{message.plaintext}</code>
          </>
        ) : (
          <p className="text-sm text-destructive" role="alert">{message.text}</p>
        )}
      </CardContent>
    </Card>
  );
}
