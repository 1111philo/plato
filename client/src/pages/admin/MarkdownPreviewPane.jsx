import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { renderMd } from '../../lib/helpers.js';

/**
 * Read-only markdown preview pane for the conversational admin editors (lesson
 * creator + knowledge base editor). Presentational only — all state is owned by
 * the parent view. The preview is refreshed manually (onRefresh runs the
 * relevant extractor agent); it is never persisted until the admin clicks the
 * parent's save button.
 *
 * Copy is parametrized so the same pane serves both editors; the defaults
 * preserve the original lesson-editor behavior.
 */
export default function MarkdownPreviewPane({
  markdown,
  loading,
  error,
  stale,
  saveLabel = 'Create Lesson',
  onRefresh,
  refreshDisabled,
  title = 'Lesson preview',
  ariaLabel = 'Lesson markdown preview',
  noun = 'lesson',
  emptyHint = 'No preview yet. Keep chatting with the editor, then click “Generate preview” to see the generated lesson markdown.',
}) {
  const hasContent = !!markdown?.trim();
  // Before the first extraction there is nothing to refresh — it's a generate.
  const refreshLabel = loading
    ? (hasContent ? 'Refreshing…' : 'Generating…')
    : (hasContent ? 'Refresh preview' : 'Generate preview');
  const showStaleHint = stale && !loading;

  // Announce refresh start/finish to screen readers. Errors are announced by
  // the role="alert" region below, so the status region stays quiet on
  // failure to avoid a double announcement.
  const [announcement, setAnnouncement] = useState('');
  const wasLoading = useRef(loading);
  useEffect(() => {
    if (loading && !wasLoading.current) {
      setAnnouncement(hasContent ? `Refreshing ${noun} preview` : `Generating ${noun} preview`);
    } else if (!loading && wasLoading.current) {
      setAnnouncement(error ? '' : `${title} updated`);
    }
    wasLoading.current = loading;
  }, [loading, error, hasContent, noun, title]);

  return (
    <aside
      aria-label={ariaLabel}
      className="flex flex-col rounded-2xl bg-muted/40 border border-border p-4"
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={onRefresh}
          disabled={refreshDisabled}
          aria-describedby={showStaleHint ? 'md-preview-stale-hint' : undefined}
        >
          {refreshLabel}
        </Button>
      </div>

      {/* Staleness hint — the conversation has advanced past the last refresh.
          Linked to the refresh button via aria-describedby so a screen-reader
          user hears why a refresh is worthwhile when the button is focused. */}
      {showStaleHint && (
        <p id="md-preview-stale-hint" className="text-xs text-muted-foreground mb-2">
          Preview may be outdated — refresh to update.
        </p>
      )}

      {/* Persistent reminder: the preview is not saved. */}
      <p
        role="note"
        className="text-xs rounded-md bg-amber-50 text-amber-800 border border-amber-200 px-3 py-2 mb-3"
      >
        This preview is not saved. Click &ldquo;{saveLabel}&rdquo; to save your changes.
      </p>

      {/* Screen-reader announcements for async refresh outcomes. */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>

      <div className="flex-1 overflow-auto">
        {error ? (
          <div
            role="alert"
            className="rounded-lg bg-destructive/10 text-destructive px-4 py-3 text-sm"
          >
            {error}
          </div>
        ) : loading ? (
          <div className="text-sm text-muted-foreground">Generating preview…</div>
        ) : hasContent ? (
          <div
            className="prose prose-sm max-w-none"
            dangerouslySetInnerHTML={{ __html: renderMd(markdown) }}
          />
        ) : (
          <div className="text-sm text-muted-foreground py-12 text-center">
            {emptyHint}
          </div>
        )}
      </div>
    </aside>
  );
}
