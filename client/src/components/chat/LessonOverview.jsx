import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Check from 'lucide-react/dist/esm/icons/check';
import { getScreenshot } from '../../../js/storage.js';
import { objectiveStatuses, objectivesMetLabel, collectArtifacts } from '../../lib/lessonWork.js';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';

/**
 * The lesson overview (#438, merged with "Your work" from Blake's review on
 * #451): one read-only dialog for a lesson, opened from the "Progress (N of
 * M Objectives)" button in the lesson header; its footer links "How
 * assessment works". It has the objectives
 * checklist (met / not yet; informational, never completes a lesson), what
 * finished work looks like, where the learner is and the coach's notes, the
 * images and links they've shared (images fetched only when that section
 * opens), and any plugin context. Works before the lesson starts, during,
 * after completion, and in View as User.
 */
export default function LessonOverview({ open, onOpenChange, lesson, lessonKB, messages }) {
  const navigate = useNavigate();
  const objectives = objectiveStatuses(lessonKB, lesson.learningObjectives);
  const complete = lessonKB?.status === 'completed';
  const started = !!lessonKB?.status;
  const artifacts = useMemo(() => collectArtifacts(messages), [messages]);
  const [artifactsOpen, setArtifactsOpen] = useState(false);
  const [images, setImages] = useState({}); // key → dataUrl | null (failed)
  const requested = useRef(new Set());
  const titleRef = useRef(null);

  // Move focus to the title on open so screen readers announce the lesson,
  // not the close button. Two nested RAFs: Base UI focuses the close button
  // on open (possibly in its own RAF), so one isn't enough to win.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const id = requestAnimationFrame(() => {
      if (!cancelled) requestAnimationFrame(() => { if (!cancelled) titleRef.current?.focus(); });
    });
    return () => { cancelled = true; cancelAnimationFrame(id); };
  }, [open]);

  // Fetch images the session doesn't already have, once the section opens.
  // Each key is requested once; results land whenever they arrive.
  useEffect(() => {
    if (!open || !artifactsOpen) return;
    const missing = artifacts.filter((a) => a.kind === 'image' && !a.dataUrl && a.key && !requested.current.has(a.key));
    for (const a of missing) {
      requested.current.add(a.key);
      getScreenshot(a.key).catch(() => null).then((url) => setImages((prev) => ({ ...prev, [a.key]: url || null })));
    }
  }, [open, artifactsOpen, artifacts]);

  const section = 'rounded-md border border-border';
  const summary = 'cursor-pointer select-none px-3 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring rounded-md';
  const imageCount = artifacts.filter((a) => a.kind === 'image').length;
  const linkCount = artifacts.length - imageCount;
  const enrichments = lessonKB?.enrichments || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent id="lesson-overview-dialog" className="sm:max-w-xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle ref={titleRef} tabIndex={-1}>{lesson.name}</DialogTitle>
          {lesson.description && <DialogDescription>{lesson.description}</DialogDescription>}
        </DialogHeader>
        {/* Focusable so keyboard users can scroll it even before anything
            inside takes focus (axe scrollable-region-focusable). */}
        <div className="overflow-y-auto flex-1 space-y-4 pr-2 rounded-sm text-sm focus-visible:outline-2 focus-visible:outline-ring" tabIndex={0} role="region" aria-label="Lesson overview">
          <div className="space-y-2">
            <h3 className="font-medium">
              Objectives <span className="font-normal text-muted-foreground">· {complete ? 'Lesson complete' : objectivesMetLabel(lessonKB, lesson.learningObjectives)}</span>
            </h3>
            <ul className="space-y-2" aria-label="Objectives">
              {objectives.map((o, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span aria-hidden="true" className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${o.met ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-muted-foreground/40'}`}>
                    {o.met && <Check className="h-3 w-3" strokeWidth={3} />}
                  </span>
                  <span>
                    {o.objective}
                    <span className="sr-only">{o.met ? ', met' : ', not yet'}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-1">
            <h3 className="font-medium">What finished work looks like</h3>
            <p className="text-muted-foreground leading-relaxed">{lessonKB?.exemplar || lesson.exemplar}</p>
          </div>

          {lessonKB?.learnerPosition && (
            <div className="space-y-1">
              <h3 className="font-medium">Where you are</h3>
              <p className="text-muted-foreground">{lessonKB.learnerPosition}</p>
            </div>
          )}
          {lessonKB?.insights?.length > 0 && (
            <div className="space-y-1">
              <h3 className="font-medium">The coach&rsquo;s notes</h3>
              <ul className="list-disc pl-5 text-muted-foreground">
                {lessonKB.insights.map((n, i) => <li key={i}>{n}</li>)}
              </ul>
            </div>
          )}

          {started && (
            <details className={section} onToggle={(e) => setArtifactsOpen(e.currentTarget.open)}>
              <summary className={summary}>
                Shared work <span className="font-normal text-muted-foreground">· {imageCount} image{imageCount === 1 ? '' : 's'}, {linkCount} link{linkCount === 1 ? '' : 's'}</span>
              </summary>
              <div className="px-3 pb-3">
                {artifacts.length === 0 ? (
                  <p className="text-muted-foreground">Nothing shared yet. Screenshots and links you send the coach appear here.</p>
                ) : (
                  <ul className="space-y-3" aria-label="Shared work">
                    {artifacts.map((a, i) => {
                      const when = a.at ? new Date(a.at).toLocaleString() : null;
                      if (a.kind === 'link') {
                        return (
                          <li key={i}>
                            <a href={a.url} target="_blank" rel="noopener noreferrer" className="text-primary underline break-all">
                              {a.title}<span className="sr-only"> (opens in a new tab)</span>
                            </a>
                            {when && <span className="block text-xs text-muted-foreground">{when}</span>}
                          </li>
                        );
                      }
                      const src = a.dataUrl || (a.key ? images[a.key] : null);
                      const failed = a.key && a.key in images && !images[a.key] && !a.dataUrl;
                      return (
                        <li key={i}>
                          {src ? (
                            <img src={src} alt={`Image you shared${when ? ` on ${when}` : ''}`} className="max-h-48 rounded-md border" />
                          ) : (
                            <p className="text-muted-foreground">{failed ? 'This image couldn’t be loaded.' : 'Loading image…'}</p>
                          )}
                          {when && <span className="block text-xs text-muted-foreground">{when}</span>}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </details>
          )}

          {enrichments.length > 0 && (
            <details className={section}>
              <summary className={summary}>Additional context</summary>
              <div className="space-y-2 px-3 pb-3">
                <p className="text-xs text-muted-foreground">Reference material gathered for this lesson from enabled plugins</p>
                {enrichments.map((enrichment, idx) => (
                  <section
                    key={idx}
                    className="border border-blue-200 bg-blue-50 rounded p-3 space-y-2"
                    aria-labelledby={`enrichment-${idx}-label`}
                  >
                    <h4 id={`enrichment-${idx}-label`} className="text-sm font-medium text-blue-900">
                      {enrichment.label || enrichment.pluginId}
                    </h4>
                    {enrichment.reasoning && (
                      <div role="note">
                        <p className="sr-only">Why this context matters:</p>
                        <p className="text-xs text-blue-700">{enrichment.reasoning}</p>
                      </div>
                    )}
                    {enrichment.context && (
                      <div>
                        <p className="sr-only">Context:</p>
                        <p className="text-sm text-gray-700 whitespace-pre-wrap">{enrichment.context}</p>
                      </div>
                    )}
                    {enrichment.sources?.length > 0 && (
                      <nav aria-label={`Sources from ${enrichment.label || enrichment.pluginId}`}>
                        <div className="text-xs font-medium text-blue-800 mb-1">Sources:</div>
                        <ul className="text-xs space-y-1">
                          {enrichment.sources.map((source, sidx) => (
                            <li key={sidx}>
                              <a
                                href={source.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-700 hover:underline focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-1 rounded"
                                aria-label={`${source.title || source.url} (opens in new tab)`}
                              >
                                {source.title || source.url}
                              </a>
                            </li>
                          ))}
                        </ul>
                      </nav>
                    )}
                  </section>
                ))}
              </div>
            </details>
          )}
        </div>
        <DialogFooter className="sm:items-center">
          {/* How lessons are judged, next to the progress it explains. */}
          <a
            href="/how-assessment-works"
            onClick={(e) => { e.preventDefault(); onOpenChange(false); navigate('/how-assessment-works'); }}
            className="self-center text-sm text-primary underline underline-offset-2"
          >
            How assessment works
          </a>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
