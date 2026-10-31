import { useEffect, useState } from 'react';
import { authenticatedFetch } from '../../js/auth.js';
import { Button } from '@/components/ui/button';

/**
 * An invite to this account (#363): the learner joined the wait list while
 * already having an account, and an admin invited them. Accept merges the
 * wait-list answers into the account (only what it doesn't have yet); Decline
 * discards the invite. Shown on the lessons list, where the invite email links. Server: GET /v1/me/invite and
 * POST /v1/me/invite/:token/{accept,decline} (lib/account-invites.js).
 */
export default function AccountInviteNotice() {
  const [invite, setInvite] = useState(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    authenticatedFetch('/v1/me/invite')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (!cancelled && data?.invite) setInvite(data.invite); })
      .catch(() => {}); // fails quietly; the invite is still there next time
    return () => { cancelled = true; };
  }, []);

  async function respond(action) {
    setBusy(true);
    setError('');
    try {
      const res = await authenticatedFetch(`/v1/me/invite/${encodeURIComponent(invite.inviteToken)}/${action}`, { method: 'POST' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Something went wrong. Please try again.');
      setInvite(null);
      setStatus(action === 'accept' ? 'Invite accepted. Your details are updated.' : 'Invite declined.');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const adds = invite ? [invite.userGroup && `the group ${invite.userGroup}`, ...(invite.fields || [])].filter(Boolean) : [];

  return (
    <>
      <p className="sr-only" role="status" aria-live="polite">{status}</p>
      {invite && (
        <section aria-labelledby="account-invite-title" className="mb-4">
          <div className="rounded-lg border bg-card p-4 text-card-foreground">
            <h2 id="account-invite-title" className="text-base font-semibold">You’re invited</h2>
            <p className="mt-1 text-sm">
              {invite.invitedByName ? `${invite.invitedByName} invited you` : 'You were invited'} with the details you gave when you joined the wait list.
              {adds.length > 0 ? ` Accepting adds ${adds.join(', ')} to your account.` : ' Your account already has them, so nothing changes.'}
            </p>
            {error && <p className="mt-2 text-sm text-red-800 dark:text-destructive" role="alert">{error}</p>}
            <div className="mt-3 flex gap-2">
              <Button size="sm" onClick={() => respond('accept')} disabled={busy}>Accept</Button>
              <Button size="sm" variant="outline" onClick={() => respond('decline')} disabled={busy}>Decline</Button>
            </div>
          </div>
        </section>
      )}
    </>
  );
}
