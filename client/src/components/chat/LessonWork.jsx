import { useEffect, useMemo, useRef, useState } from 'react';
import Check from 'lucide-react/dist/esm/icons/check';
import { getScreenshot } from '../../../js/storage.js';
import { objectiveStatuses, collectArtifacts } from '../../lib/lessonWork.js';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';

/**
 * "Your work" (#438): a read-only view of a lesson without scrolling the
 * chat. Progress (objectives checklist), Summary (exemplar, where you are,
 * the coach's notes), and Artifacts (images and links you shared, images
 * fetched only when that section opens). Works the same on completed
 * lessons and in View as User. Sections are native <details>.
 */
export default function LessonWork({ open, onOpenChange, lesson, lessonKB, messages }) {
  const objectives = objectiveStatuses(lessonKB, lesson.learningObjectives);
  const metCount = objectives.filter((o) => o.met).length;
  const complete = lessonKB?.status === 'completed';
  const progress = complete ? 10 : (lessonKB?.progress ?? 0);
  const artifacts = useMemo(() => collectArtifacts(messages), [messages]);
  const [artifactsOpen, setArtifactsOpen] = useState(false);
  const [images, setImages] = useState({}); // key → dataUrl | null (failed)
  const requested = useRef(new Set());

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent id="lesson-work-dialog" className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Your work</DialogTitle>
          <DialogDescription>{lesson.name}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <details open className={section}>
            <summary className={summary}>
              Progress <span className="font-normal text-muted-foreground">· {complete ? 'Complete' : `${progress} of 10`}, {metCount} of {objectives.length} objectives</span>
            </summary>
            <ul className="space-y-2 px-3 pb-3 text-sm" aria-label="Objectives">
              {objectives.map((o, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span aria-hidden="true" className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${o.met ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-muted-foreground/40'}`}>
                    {o.met && <Check className="h-3 w-3" strokeWidth={3} />}
                  </span>
                  <span>
                    {o.objective}
                    <span className="sr-only">{o.met ? ', shown' : ', not yet'}</span>
                  </span>
                </li>
              ))}
            </ul>
          </details>

          <details className={section}>
            <summary className={summary}>Summary</summary>
            <div className="space-y-3 px-3 pb-3 text-sm">
              <div>
                <h3 className="font-medium">What finished work looks like</h3>
                <p className="text-muted-foreground">{lessonKB?.exemplar || lesson.exemplar}</p>
              </div>
              {lessonKB?.learnerPosition && (
                <div>
                  <h3 className="font-medium">Where you are</h3>
                  <p className="text-muted-foreground">{lessonKB.learnerPosition}</p>
                </div>
              )}
              {lessonKB?.insights?.length > 0 && (
                <div>
                  <h3 className="font-medium">The coach&rsquo;s notes</h3>
                  <ul className="list-disc pl-5 text-muted-foreground">
                    {lessonKB.insights.map((n, i) => <li key={i}>{n}</li>)}
                  </ul>
                </div>
              )}
            </div>
          </details>

          <details className={section} onToggle={(e) => setArtifactsOpen(e.currentTarget.open)}>
            <summary className={summary}>
              Artifacts <span className="font-normal text-muted-foreground">· {imageCount} image{imageCount === 1 ? '' : 's'}, {linkCount} link{linkCount === 1 ? '' : 's'}</span>
            </summary>
            <div className="px-3 pb-3 text-sm">
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
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
