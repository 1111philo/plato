/**
 * Teacher Comments — comment thread for a user's edit page.
 *
 * Slot: adminProfileFields. Renders inline below the Edit User form fields.
 *
 * Props (slot contract): { user: AdminUser }
 *
 * Traditional thread UX: list of comments newest-first, each with author
 * attribution + timestamp + delete button; an "Add comment" textarea at the
 * top. No editing in place — admins delete + re-add if they want to revise.
 * That's deliberate; the audit story is cleaner if comments are append-only
 * from the admin's perspective.
 */

import { useEffect, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
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

function relativeTime(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms) || ms < 0) return '';
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  if (sec < 86400 * 7) return `${Math.floor(sec / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

function fullTime(iso) {
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

function initials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase()).join('') || '?';
}

export default function ProfileField({ user }) {
  const [comments, setComments] = useState([]);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [confirmingDelete, setConfirmingDelete] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api('GET', `/v1/plugins/teacher-comments/admin/comments/${user.userId}`);
      setComments(Array.isArray(data?.comments) ? data.comments : []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [user.userId]);

  useEffect(() => { load(); }, [load]);

  async function postComment() {
    const text = draft.trim();
    if (!text) return;
    setPosting(true);
    setError(null);
    try {
      const created = await api('POST', `/v1/plugins/teacher-comments/admin/comments/${user.userId}`, { text });
      setComments((cs) => [created, ...cs]);
      setDraft('');
    } catch (e) {
      setError(e.message);
    } finally {
      setPosting(false);
    }
  }

  async function deleteComment(id) {
    setError(null);
    try {
      await api('DELETE', `/v1/plugins/teacher-comments/admin/comments/${user.userId}/${id}`);
      setComments((cs) => cs.filter((c) => c.id !== id));
    } catch (e) {
      setError(e.message);
    } finally {
      setConfirmingDelete(null);
    }
  }

  function onKeyDown(e) {
    // Cmd/Ctrl+Enter posts — matches the lesson chat send shortcut elsewhere in plato.
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      postComment();
    }
  }

  return (
    <section className="space-y-4" aria-label="Admin comments">
      <Separator />
      <div className="flex items-baseline justify-between">
        <h2 className="text-base font-semibold">Admin comments</h2>
        <span className="text-xs text-muted-foreground">
          Private — visible only to admins
        </span>
      </div>

      {/* New comment composer */}
      <div className="space-y-2">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={`Add a comment about ${user.name || user.email}…`}
          rows={3}
          maxLength={4000}
          aria-label="New comment"
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            ⌘/Ctrl + Enter to post
          </span>
          <Button onClick={postComment} disabled={posting || !draft.trim()} size="sm">
            {posting ? 'Posting…' : 'Post comment'}
          </Button>
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">{error}</p>
      )}

      {/* Thread */}
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading comments…</p>
      ) : comments.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">No comments yet.</p>
      ) : (
        <ul className="space-y-3">
          {comments.map((c) => (
            <li key={c.id} className="flex gap-3 rounded-md border bg-card p-3">
              <div
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold"
                aria-hidden="true"
              >
                {initials(c.authorName)}
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium truncate">
                    {c.authorName || 'Admin'}
                  </span>
                  <time
                    dateTime={c.createdAt}
                    title={fullTime(c.createdAt)}
                    className="text-xs text-muted-foreground shrink-0"
                  >
                    {relativeTime(c.createdAt)}
                  </time>
                </div>
                <p className="whitespace-pre-wrap text-sm">{c.text}</p>
                <div className="pt-1">
                  {confirmingDelete === c.id ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">Delete this comment?</span>
                      <Button size="sm" variant="destructive" onClick={() => deleteComment(c.id)}>
                        Delete
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirmingDelete(null)}>
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-xs text-muted-foreground hover:text-destructive"
                      onClick={() => setConfirmingDelete(c.id)}
                      aria-label={`Delete comment by ${c.authorName || 'Admin'}`}
                    >
                      Delete
                    </Button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
