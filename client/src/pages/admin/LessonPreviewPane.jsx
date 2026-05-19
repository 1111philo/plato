import { Button } from '@/components/ui/button';
import { renderMd } from '../../lib/helpers.js';

/**
 * Read-only markdown preview pane for the lesson editor (NewLessonView).
 * Presentational only — all state is owned by NewLessonView. The preview is
 * refreshed manually (onRefresh runs the lesson-extractor agent); it is never
 * persisted until the admin clicks "Create/Update Lesson".
 */
export default function LessonPreviewPane({
  markdown,
  loading,
  error,
  stale,
  isCreate,
  refreshDisabled,
  onRefresh,
}) {
  const hasContent = !!markdown?.trim();
  const saveLabel = isCreate ? 'Create Lesson' : 'Update Lesson';

  return (
    <aside
      aria-label="Lesson markdown preview"
      className="flex flex-col rounded-2xl bg-muted/40 border border-border p-4"
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <h2 className="text-sm font-semibold">Lesson preview</h2>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={onRefresh}
          disabled={refreshDisabled}
        >
          {loading ? 'Refreshing…' : 'Refresh preview'}
        </Button>
      </div>

      {/* Staleness hint — the conversation has advanced past the last refresh. */}
      {stale && !loading && (
        <p className="text-xs text-muted-foreground mb-2">
          Preview may be outdated — refresh to update.
        </p>
      )}

      {/* Persistent reminder: the preview is not the saved lesson. */}
      <p
        role="note"
        className="text-xs rounded-md bg-amber-50 text-amber-800 border border-amber-200 px-3 py-2 mb-3"
      >
        This preview is not saved. Click &ldquo;{saveLabel}&rdquo; to save your changes.
      </p>

      {/* Screen-reader announcements for async refresh outcomes. */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {loading ? 'Refreshing preview' : error ? `Preview error: ${error}` : ''}
      </div>

      <div className="flex-1 overflow-auto">
        {error ? (
          <div role="alert" className="text-sm text-destructive">{error}</div>
        ) : loading ? (
          <div className="text-sm text-muted-foreground">Generating preview…</div>
        ) : hasContent ? (
          <div
            className="prose prose-sm max-w-none"
            dangerouslySetInnerHTML={{ __html: renderMd(markdown) }}
          />
        ) : (
          <div className="text-sm text-muted-foreground py-8 text-center">
            No preview yet. Keep chatting with the editor, then click
            &ldquo;Refresh preview&rdquo; to see the generated lesson markdown.
          </div>
        )}
      </div>
    </aside>
  );
}
