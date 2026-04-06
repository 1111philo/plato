import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../contexts/AppContext.jsx';
import { getLessonKB } from '../../js/storage.js';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from '@/components/ui/dialog';

export default function LessonsList() {
  const { state, dispatch } = useApp();
  const navigate = useNavigate();
  const { lessons } = state;
  const [lessonData, setLessonData] = useState({});
  const [detailLesson, setDetailLesson] = useState(null);

  useEffect(() => {
    (async () => {
      const data = {};
      for (const c of lessons) {
        const kb = await getLessonKB(c.lessonId);
        data[c.lessonId] = {
          status: kb?.status || null,
          progress: kb?.progress ?? null,
        };
      }
      setLessonData(data);
    })();
  }, [lessons]);

  function statusIcon(lessonId) {
    const d = lessonData[lessonId];
    if (d?.status === 'completed') return '\u2713';
    if (d?.status) return '\u25B6';
    return '\u25CB';
  }

  function progressLabel(lesson) {
    const d = lessonData[lesson.lessonId];
    if (d?.status === 'completed') return 'Completed';
    if (d?.progress != null) return `${d.progress * 10}% toward exemplar`;
    if (d?.status) return 'In progress';
    return null;
  }

  const LessonIcon = ({ children }) => (
    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs text-primary" aria-hidden="true">
      {children}
    </span>
  );

  const LessonItem = ({ index, onClick, dashed, children }) => (
    <li
      className="animate-in fade-in slide-in-from-bottom-2 fill-mode-both list-none"
      style={{ animationDelay: `${index * 40}ms` }}
    >
      <button
        className="w-full text-left"
        onClick={onClick}
      >
        <Card className={`transition-colors hover:bg-accent/50 cursor-pointer ${dashed ? 'border-dashed' : ''}`}>
          <CardContent className="flex items-start gap-3">
            {children}
          </CardContent>
        </Card>
      </button>
    </li>
  );

  return (
    <div className="mx-auto max-w-lg p-4">
      <h2 className="text-xl font-semibold mb-4">Lessons</h2>
      <ul className="space-y-3" role="list">
        {lessons.map((c, i) => (
          <LessonItem key={c.lessonId} index={i} onClick={() => navigate(`/lessons/${c.lessonId}`)}>
            <LessonIcon>{statusIcon(c.lessonId)}</LessonIcon>
            <div className="min-w-0 flex-1 space-y-1">
              <strong className="text-sm font-medium">{c.name}</strong>
              {c.description && <p className="text-sm text-muted-foreground line-clamp-2">{c.description}</p>}
              <div className="flex items-center gap-2 flex-wrap">
                {c.lessonId.startsWith('custom-') && <Badge variant="outline" className="text-xs">My Lesson</Badge>}
                {progressLabel(c) && <Badge variant="secondary" className="text-xs">{progressLabel(c)}</Badge>}
                <span className="text-xs text-primary hover:underline cursor-pointer"
                  role="button" tabIndex={0}
                  onClick={(e) => { e.stopPropagation(); setDetailLesson(c); }}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); setDetailLesson(c); } }}
                  aria-label={`View ${c.learningObjectives.length} objectives for ${c.name}`}>
                  {c.learningObjectives.length} objectives
                </span>
              </div>
            </div>
          </LessonItem>
        ))}

      </ul>

      {detailLesson && (
        <LessonDetailDialog
          lesson={detailLesson}
          progress={lessonData[detailLesson.lessonId]}
          open={!!detailLesson}
          onOpenChange={(open) => { if (!open) setDetailLesson(null); }}
        />
      )}
    </div>
  );
}

function LessonDetailDialog({ lesson, progress, open, onOpenChange }) {
  const pct = progress?.status === 'completed' ? 100 : (progress?.progress != null ? progress.progress * 10 : null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{lesson.name}</DialogTitle>
          {lesson.description && (
            <DialogDescription>{lesson.description}</DialogDescription>
          )}
        </DialogHeader>

        {pct != null && (
          <div
            className="space-y-1"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            aria-label={`Lesson progress: ${pct}%`}
          >
            <div className="flex justify-between text-xs text-muted-foreground" aria-hidden="true">
              <span>Starting</span>
              <span>{progress.status === 'completed' ? 'Completed' : `${pct}%`}</span>
            </div>
            <div className="h-1 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}

        <div className="space-y-2">
          <h3 className="text-sm font-medium">Exemplar</h3>
          <p className="text-sm text-muted-foreground leading-relaxed">{lesson.exemplar}</p>
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-medium">Learning Objectives</h3>
          <ul className="list-disc pl-5 text-sm text-muted-foreground leading-relaxed space-y-1">
            {lesson.learningObjectives.map((obj, i) => (
              <li key={i}>{obj}</li>
            ))}
          </ul>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
