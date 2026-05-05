import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { authenticatedFetch } from '../../../client/js/auth.js';
import { createPkceChallenge, createPkceVerifier } from './pkce.js';

export default function LearnerCompletionAfter({ lessonId }) {
  const checkedRef = useRef(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!lessonId || checkedRef.current === lessonId) return;
    checkedRef.current = lessonId;
    let cancelled = false;
    (async () => {
      try {
        const res = await authenticatedFetch('/v1/plugins/openrouter-rewards/check-pending', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lessonId }),
        });
        const data = await res.json();
        if (!cancelled) setResult(data);
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    })();
    return () => { cancelled = true; };
  }, [lessonId]);

  async function startOauth() {
    setBusy(true);
    setError('');
    try {
      const verifier = createPkceVerifier();
      const codeChallenge = await createPkceChallenge(verifier);
      const res = await authenticatedFetch('/v1/plugins/openrouter-rewards/oauth/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codeChallenge }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not start OpenRouter sign-in');
      sessionStorage.setItem(`or-pkce-verifier:${data.state}`, verifier);
      window.location.assign(data.authorizationUrl);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  if (!result || result.status === 'no-claim') return null;

  return (
    <Card>
      <CardContent className="space-y-3">
        {result.status === 'pending-oauth' && (
          <>
            <p className="text-sm">You earned ${result.accumulatedAmount} in OpenRouter credits.</p>
            <Button onClick={startOauth} disabled={busy}>{busy ? 'Opening...' : 'Claim OpenRouter credits'}</Button>
          </>
        )}
        {result.status === 'processing' && <p className="text-sm">Reward is being prepared.</p>}
        {result.status === 'topped-up' && <p className="text-sm">Your OpenRouter key limit increased by ${result.addedCredit}.</p>}
        {result.status === 'minted' && <RevealKey plaintext={result.plaintext} />}
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      </CardContent>
    </Card>
  );
}

function RevealKey({ plaintext }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-2">
      <p className="text-sm">This key is shown once in plato. If your classroom enabled Slack delivery, it may also appear in Slack.</p>
      <code className="block break-all rounded bg-muted p-2 text-xs">{plaintext}</code>
      <Button
        variant="outline"
        onClick={async () => {
          await navigator.clipboard.writeText(plaintext);
          setCopied(true);
        }}
      >
        {copied ? 'Copied' : 'Copy key'}
      </Button>
    </div>
  );
}
