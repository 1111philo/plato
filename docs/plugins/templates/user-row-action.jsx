/**
 * Template: a row-level action button on the admin Users page.
 *
 * Slot: adminUserRowAction (Phase 2 — declared in the SDK, not yet rendered by the host).
 * Capability: ui.slot.adminUserRowAction
 *
 * Props: { user: { userId, email, name?, username?, userGroup?, role, createdAt } }
 *
 * Returns a <Button> that does something with the user (e.g. invite via your
 * external system, attach metadata, etc.).
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { authenticatedFetch } from '../../../client/js/auth.js';

export default function UserRowAction({ user }) {
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    setBusy(true);
    try {
      const res = await authenticatedFetch('/v1/plugins/<your-id>/admin/do-thing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.userId }),
      });
      if (!res.ok) throw new Error('Request failed');
    } catch {
      // Show error (toast, alert, whatever your plugin uses)
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button size="sm" variant="outline" onClick={handleClick} disabled={busy}>
      {busy ? '…' : 'Do thing'}
    </Button>
  );
}
