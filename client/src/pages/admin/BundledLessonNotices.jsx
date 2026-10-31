import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminApi } from './adminApi.js';
import ConfirmModal from '../../components/modals/ConfirmModal.jsx';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';

/**
 * Admin → Lessons notices for lessons that ship with plato (#443):
 * "publish it" when Getting Started arrived private on an existing
 * classroom, and "update available" when an edited copy is behind the
 * bundled version (an unedited copy updates itself on deploy).
 * Server: lib/bundled-lessons.js, /v1/admin/bundled-lessons.
 */
export default function BundledLessonNotices({ onChanged, onMessage }) {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [viewing, setViewing] = useState(null);
  const [confirming, setConfirming] = useState(null);

  const fetchItems = useCallback(
    () => adminApi('GET', '/v1/admin/bundled-lessons').then((d) => d.lessons || []).catch(() => []),
    [],
  );
  const load = useCallback(async () => setItems(await fetchItems()), [fetchItems]);
  useEffect(() => {
    let cancelled = false;
    fetchItems().then((list) => { if (!cancelled) setItems(list); });
    return () => { cancelled = true; };
  }, [fetchItems]);

  async function act(item, action, successText) {
    try {
      await adminApi('POST', `/v1/admin/bundled-lessons/${encodeURIComponent(item.lessonId)}`, { action });
      await load();
      if (action === 'apply') await onChanged?.();
      if (successText) onMessage?.({ text: successText, type: 'success' });
    } catch (e) {
      onMessage?.({ text: e.message, type: 'error' });
    }
  }

  const notices = items.filter((i) => i.needsPublish || i.updateAvailable);
  if (notices.length === 0) return null;

  return (
    <>
      <ul className="space-y-2 mb-4" aria-label="Lessons that ship with plato">
        {notices.map((item) => (
          <li key={item.lessonId} className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950">
            {item.updateAvailable ? (
              <p>
                <strong>{item.name}</strong> has an update from plato. Your copy was edited, so it wasn&rsquo;t changed.
              </p>
            ) : (
              <p>
                <strong>{item.name}</strong> was added to show learners how lessons work. It&rsquo;s private until you publish it.
              </p>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              {item.updateAvailable ? (
                <>
                  <Button size="sm" variant="outline" onClick={() => setViewing(item)}>View update</Button>
                  <Button size="sm" onClick={() => setConfirming(item)}>Apply update</Button>
                  <Button size="sm" variant="ghost" onClick={() => act(item, 'dismiss')}>Dismiss</Button>
                </>
              ) : (
                <>
                  <Button size="sm" onClick={() => navigate(`/plato/lessons/${encodeURIComponent(item.lessonId)}/edit`)}>Review lesson</Button>
                  <Button size="sm" variant="ghost" onClick={() => act(item, 'dismiss-publish')}>Dismiss</Button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>

      <Dialog open={!!viewing} onOpenChange={(o) => { if (!o) setViewing(null); }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{viewing?.name}: latest version</DialogTitle>
            <DialogDescription>Applying it replaces your edited copy. Its status, unit, and learner progress stay.</DialogDescription>
          </DialogHeader>
          <pre className="max-h-[50dvh] overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs" tabIndex={0} aria-label="Latest lesson markdown">
            {viewing?.latestMarkdown}
          </pre>
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewing(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmModal
        open={!!confirming}
        onOpenChange={(o) => { if (!o) setConfirming(null); }}
        title={`Apply the update to ${confirming?.name || 'this lesson'}?`}
        message="Your edits to this lesson are replaced with plato's latest version. Its status, unit, and learner progress stay."
        confirmLabel="Apply update"
        onConfirm={() => { const item = confirming; setConfirming(null); act(item, 'apply', `${item.name} updated.`); }}
      />
    </>
  );
}
