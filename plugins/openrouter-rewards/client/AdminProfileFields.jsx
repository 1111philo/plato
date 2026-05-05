import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { authenticatedFetch } from '../../../client/js/auth.js';

export default function AdminProfileFields({ user }) {
  const [status, setStatus] = useState(null);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    if (!user?.userId) return;
    const res = await authenticatedFetch(`/v1/plugins/openrouter-rewards/admin/status/${user.userId}`);
    if (res.ok) setStatus(await res.json());
  }

  useEffect(() => { load().catch(() => {}); }, [user?.userId]);

  async function post(path, success) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await authenticatedFetch(path, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');
      setMessage({ type: 'success', text: success });
      await load();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <Separator />
      <div className="space-y-2">
        <h3 className="text-sm font-medium">OpenRouter Rewards</h3>
        <p className="text-sm text-muted-foreground">
          {status?.keyHashSuffix ? `Key ending in ${status.keyHashSuffix}; lifetime awarded $${status.lifetimeAwarded}.` : 'No OpenRouter key issued.'}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={busy || !user?.userId || !status?.keyHashSuffix}
            onClick={() => post(`/v1/plugins/openrouter-rewards/admin/reissue-request/${user.userId}`, 'Reissue queued.')}
          >
            Queue reissue
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={busy || !status?.keyHashSuffix}
            onClick={() => post(`/v1/plugins/openrouter-rewards/admin/revoke/${user.userId}`, 'Key revoked.')}
          >
            Revoke
          </Button>
        </div>
        {message && <p className={`text-sm ${message.type === 'error' ? 'text-destructive' : 'text-green-700'}`} role="status">{message.text}</p>}
      </div>
    </div>
  );
}
