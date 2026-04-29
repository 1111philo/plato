/**
 * Teacher Comments — admin settings panel.
 *
 * Renders inside the plugin card on /plato/plugins. Lists every learner with a
 * textarea for the admin's note. Comments persist via the plugin's own routes.
 *
 * NOTE: Phase 1 doesn't yet render the `adminUserRowAction` slot in
 * AdminUsers.jsx — the natural place for a per-user note is the row itself.
 * This panel is the workaround. See plugins/teacher-comments/GAPS.md.
 */

import { useEffect, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { authenticatedFetch } from '../../../client/js/auth.js';

async function api(method, path, body) {
  const res = await authenticatedFetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export default function SettingsPanel() {
  const [users, setUsers] = useState([]);
  const [comments, setComments] = useState({});
  const [drafts, setDrafts] = useState({});
  const [savingId, setSavingId] = useState(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const [u, c] = await Promise.all([
        api('GET', '/v1/admin/users'),
        api('GET', '/v1/plugins/teacher-comments/admin/comments'),
      ]);
      setUsers(Array.isArray(u) ? u : []);
      setComments(c && typeof c === 'object' ? c : {});
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save(userId) {
    setSavingId(userId);
    try {
      const text = (drafts[userId] ?? comments[userId]?.text ?? '').trim();
      await api('PUT', `/v1/plugins/teacher-comments/admin/comments/${userId}`, { text });
      const next = { ...comments };
      if (text === '') delete next[userId];
      else next[userId] = { ...(next[userId] || {}), text, updatedAt: new Date().toISOString() };
      setComments(next);
      setDrafts((d) => {
        const copy = { ...d };
        delete copy[userId];
        return copy;
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setSavingId(null);
    }
  }

  const filtered = users.filter((u) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (u.email || '').toLowerCase().includes(q)
        || (u.name || '').toLowerCase().includes(q)
        || (u.username || '').toLowerCase().includes(q);
  });

  return (
    <div className="space-y-3">
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Filter users by name, username, or email"
        aria-label="Filter users"
      />
      {filtered.length === 0 && (
        <p className="text-sm text-muted-foreground">No users match.</p>
      )}
      <ul className="divide-y rounded-md border">
        {filtered.map((u) => {
          const existing = comments[u.userId]?.text || '';
          const draft = drafts[u.userId];
          const value = draft ?? existing;
          const dirty = draft !== undefined && draft !== existing;
          return (
            <li key={u.userId} className="space-y-2 p-3">
              <div className="flex items-baseline justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium truncate">{u.name || u.username || u.email}</div>
                  <div className="text-xs text-muted-foreground truncate">{u.email}</div>
                </div>
                {comments[u.userId]?.updatedAt && (
                  <span className="text-xs text-muted-foreground shrink-0">
                    {new Date(comments[u.userId].updatedAt).toLocaleDateString()}
                  </span>
                )}
              </div>
              <Textarea
                value={value}
                onChange={(e) => setDrafts((d) => ({ ...d, [u.userId]: e.target.value }))}
                placeholder="Add a private note about this learner…"
                rows={2}
                maxLength={4000}
                aria-label={`Note for ${u.name || u.email}`}
              />
              {dirty && (
                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={() => save(u.userId)} disabled={savingId === u.userId}>
                    {savingId === u.userId ? 'Saving…' : 'Save'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setDrafts((d) => {
                      const copy = { ...d };
                      delete copy[u.userId];
                      return copy;
                    })}
                  >
                    Cancel
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
