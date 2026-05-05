import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { authenticatedFetch } from '../../../client/js/auth.js';

export default function LearnerProfileFields() {
  const [status, setStatus] = useState(null);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);

  async function loadStatus() {
    const res = await authenticatedFetch('/v1/plugins/openrouter-rewards/status');
    if (res.ok) setStatus(await res.json());
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await authenticatedFetch('/v1/plugins/openrouter-rewards/status');
      if (!cancelled && res.ok) setStatus(await res.json());
    })().catch(() => {});
    return () => { cancelled = true; };
  }, []);

  async function claim() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await authenticatedFetch('/v1/plugins/openrouter-rewards/check-pending', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Claim failed');
      if (data.status === 'minted') setMessage({ type: 'success', plaintext: data.plaintext });
      else if (data.status === 'topped-up') setMessage({ type: 'success', text: `Your key limit increased by $${data.addedCredit}.` });
      else if (data.status === 'no-claim') setMessage({ type: 'error', text: 'No rewards available right now.' });
      else if (data.status === 'processing') setMessage({ type: 'error', text: 'A reward is already being prepared. Try again in a moment.' });
      await loadStatus();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function reissue() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await authenticatedFetch('/v1/plugins/openrouter-rewards/reissue', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Reissue failed');
      if (data.status === 'processing') {
        setMessage({ type: 'error', text: 'A replacement key is already being prepared. Try again in a moment.' });
      } else if (data.revealUnavailable) {
        setMessage({ type: 'error', text: 'The replacement key was finalized, but its plaintext is no longer available. Ask an admin to queue another reissue.' });
      } else if (data.plaintext) {
        setMessage({ type: 'success', plaintext: data.plaintext });
      } else {
        setMessage({ type: 'success', text: 'Your replacement key was finalized.' });
      }
      await loadStatus();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  }

  if (!message && !status?.keyHashSuffix && !status?.availableReward && !status?.pendingReissue) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>OpenRouter Rewards</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {status?.keyHashSuffix && (
          <div className="space-y-1">
            <p className="text-sm">
              Your OpenRouter API key is active. Use it at{' '}
              <a
                href="https://openrouter.ai"
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                openrouter.ai
              </a>{' '}
              to access AI models with the credits you've earned.
            </p>
            <p className="text-xs text-muted-foreground">
              Lifetime credits awarded: ${status.lifetimeAwarded}.
            </p>
          </div>
        )}
        {status?.availableReward && (
          <div className="space-y-2">
            <p className="text-sm">You have ${status.availableReward.accumulatedAmount} in credits ready to claim.</p>
            <Button onClick={claim} disabled={busy}>{busy ? 'Minting your key…' : 'Claim OpenRouter credits'}</Button>
          </div>
        )}
        {status?.pendingReissue && status?.keyHashSuffix && <p className="text-sm">A replacement key is ready to claim.</p>}
        {status?.pendingReissue && !status?.keyHashSuffix && (
          <p className="text-sm text-muted-foreground">A replacement key was requested, but there is no active key to reissue.</p>
        )}
        {status?.keyHashSuffix && (
          <Button variant="outline" onClick={reissue} disabled={busy}>{busy ? 'Reissuing…' : 'Reissue key'}</Button>
        )}
        {message?.type === 'success' && message.plaintext && (
          <>
            <p className="text-sm">Copy this key now — it won't be shown again.</p>
            <code className="block break-all rounded bg-muted p-2 text-xs">{message.plaintext}</code>
          </>
        )}
        {message?.type === 'success' && !message.plaintext && message.text && (
          <p className="text-sm" role="status">{message.text}</p>
        )}
        {message?.type === 'error' && <p className="text-sm text-destructive" role="alert">{message.text}</p>}
      </CardContent>
    </Card>
  );
}
