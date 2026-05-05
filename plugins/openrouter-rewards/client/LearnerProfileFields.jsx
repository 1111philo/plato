import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { authenticatedFetch } from '../../../client/js/auth.js';

export default function LearnerProfileFields() {
  const [status, setStatus] = useState(null);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await authenticatedFetch('/v1/plugins/openrouter-rewards/status');
    if (res.ok) setStatus(await res.json());
  }

  useEffect(() => { load().catch(() => {}); }, []);

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

  if (!status?.keyHashSuffix && !status?.pendingClaim && !status?.pendingReissue) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>OpenRouter Rewards</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {status.keyHashSuffix && <p className="text-sm">Active key ending in {status.keyHashSuffix}. Lifetime awarded: ${status.lifetimeAwarded}.</p>}
        {status.pendingClaim && <p className="text-sm">You have ${status.pendingClaim.accumulatedAmount} in credits ready to claim.</p>}
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
