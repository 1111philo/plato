import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { authenticatedFetch } from '../../../client/js/auth.js';
import { completeOpenRouterClaimFromUrl, startOpenRouterClaim } from './claim-flow.js';

export default function LearnerProfileFields() {
  const [status, setStatus] = useState(null);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await authenticatedFetch('/v1/plugins/openrouter-rewards/status');
    if (res.ok) setStatus(await res.json());
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const claimResult = await completeOpenRouterClaimFromUrl();
      if (!cancelled && claimResult) setMessage(claimResult);
      const res = await authenticatedFetch('/v1/plugins/openrouter-rewards/status');
      if (!cancelled && res.ok) setStatus(await res.json());
    })().catch(() => {});
    return () => { cancelled = true; };
  }, []);

  async function reissue() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await authenticatedFetch('/v1/plugins/openrouter-rewards/reissue', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Reissue failed');
      setMessage({ type: 'success', plaintext: data.plaintext });
      await load();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function claim() {
    setBusy(true);
    setMessage(null);
    try {
      await startOpenRouterClaim();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
      setBusy(false);
    }
  }

  if (!message && !status?.keyHashSuffix && !status?.pendingClaim && !status?.pendingReissue) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>OpenRouter Rewards</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {status.keyHashSuffix && <p className="text-sm">Active key ending in {status.keyHashSuffix}. Lifetime awarded: ${status.lifetimeAwarded}.</p>}
        {status.pendingClaim && (
          <div className="space-y-2">
            <p className="text-sm">You have ${status.pendingClaim.accumulatedAmount} in credits ready to claim.</p>
            <Button onClick={claim} disabled={busy}>{busy ? 'Opening...' : 'Claim OpenRouter credits'}</Button>
          </div>
        )}
        {status.pendingReissue && <p className="text-sm">A replacement key is ready to claim.</p>}
        {status.keyHashSuffix && <Button variant="outline" onClick={reissue} disabled={busy}>{busy ? 'Reissuing...' : 'Reissue key'}</Button>}
        {message?.type === 'success' && (
          <code className="block break-all rounded bg-muted p-2 text-xs">{message.plaintext}</code>
        )}
        {message?.type === 'error' && <p className="text-sm text-destructive" role="alert">{message.text}</p>}
      </CardContent>
    </Card>
  );
}
