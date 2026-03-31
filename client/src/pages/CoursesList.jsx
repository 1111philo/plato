import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../contexts/AppContext.jsx';
import { getCourseKB, getDraftCourseId, saveUserCourse } from '../../js/storage.js';
import { parseCoursePrompt, invalidateCoursesCache, loadCourses } from '../../js/courseOwner.js';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from '@/components/ui/dialog';

export default function CoursesList() {
  const { state, dispatch } = useApp();
  const navigate = useNavigate();
  const { courses } = state;
  const [courseData, setCourseData] = useState({});
  const [hasDraft, setHasDraft] = useState(false);
  const [detailCourse, setDetailCourse] = useState(null);
  const fileRef = useRef(null);

  useEffect(() => {
    (async () => {
      const data = {};
      for (const c of courses) {
        const kb = await getCourseKB(c.courseId);
        data[c.courseId] = {
          status: kb?.status || null,
          progress: kb?.progress ?? null,
        };
      }
      setCourseData(data);
      setHasDraft(!!(await getDraftCourseId()));
    })();
  }, [courses]);

  function statusIcon(courseId) {
    const d = courseData[courseId];
    if (d?.status === 'completed') return '\u2713';
    if (d?.status) return '\u25B6';
    return '\u25CB';
  }

  function progressLabel(course) {
    const d = courseData[course.courseId];
    if (d?.status === 'completed') return 'Completed';
    if (d?.progress != null) return `${d.progress * 10}% toward exemplar`;
    if (d?.status) return 'In progress';
    return null;
  }

  const handleImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const markdown = await file.text();
    const courseId = `custom-${Date.now()}`;
    const course = parseCoursePrompt(courseId, markdown);

    if (!course.name || !course.exemplar || !course.learningObjectives.length) {
      alert('Invalid course file. Must have a title, exemplar, and learning objectives.');
      return;
    }

    await saveUserCourse(courseId, markdown);
    invalidateCoursesCache();
    const refreshed = await loadCourses();
    dispatch({ type: 'REFRESH_COURSES', courses: refreshed });
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div className="mx-auto max-w-lg p-4">
      <h2 className="text-xl font-semibold mb-4">Courses</h2>
      <div className="space-y-3" role="list">
        {courses.map((c, i) => {
          const icon = statusIcon(c.courseId);
          const pLabel = progressLabel(c);
          return (
            <button
              key={c.courseId}
              className="w-full text-left animate-in fade-in slide-in-from-bottom-2 fill-mode-both"
              style={{ animationDelay: `${i * 40}ms` }}
              role="listitem"
              onClick={() => navigate(`/courses/${c.courseId}`)}
            >
              <Card className="transition-colors hover:bg-accent/50 cursor-pointer">
                <CardContent className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs text-primary" aria-hidden="true">
                    {icon}
                  </span>
                  <div className="min-w-0 flex-1 space-y-1">
                    <strong className="text-sm font-medium">{c.name}</strong>
                    {c.description && <p className="text-sm text-muted-foreground line-clamp-2">{c.description}</p>}
                    <div className="flex items-center gap-2 flex-wrap">
                      {pLabel && <Badge variant="secondary" className="text-xs">{pLabel}</Badge>}
                      <button
                        className="text-xs text-primary hover:underline"
                        onClick={(e) => { e.stopPropagation(); setDetailCourse(c); }}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); setDetailCourse(c); } }}
                      >
                        {c.learningObjectives.length} objectives
                      </button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </button>
          );
        })}

        <button
          className="w-full text-left animate-in fade-in slide-in-from-bottom-2 fill-mode-both"
          style={{ animationDelay: `${courses.length * 40}ms` }}
          role="listitem"
          onClick={() => navigate('/courses/create')}
        >
          <Card className="border-dashed transition-colors hover:bg-accent/50 cursor-pointer">
            <CardContent className="flex items-start gap-3">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs text-primary" aria-hidden="true">
                +
              </span>
              <div className="min-w-0 flex-1 space-y-1">
                <strong className="text-sm font-medium">{hasDraft ? 'Continue Course Draft' : 'Create Your Own Course'}</strong>
                <p className="text-sm text-muted-foreground">{hasDraft ? 'Resume designing your course' : 'Design a custom course with AI guidance'}</p>
              </div>
            </CardContent>
          </Card>
        </button>

        <input
          ref={fileRef}
          type="file"
          accept=".md,text/markdown"
          onChange={handleImport}
          className="sr-only"
          aria-label="Import course file"
        />
        <button
          className="w-full text-left animate-in fade-in slide-in-from-bottom-2 fill-mode-both"
          style={{ animationDelay: `${(courses.length + 1) * 40}ms` }}
          role="listitem"
          onClick={() => fileRef.current?.click()}
        >
          <Card className="border-dashed transition-colors hover:bg-accent/50 cursor-pointer">
            <CardContent className="flex items-start gap-3">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary" aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              </span>
              <div className="min-w-0 flex-1 space-y-1">
                <strong className="text-sm font-medium">Import Course</strong>
                <p className="text-sm text-muted-foreground">Load a course from a .md file</p>
              </div>
            </CardContent>
          </Card>
        </button>
      </div>

      {detailCourse && (
        <CourseDetailDialog
          course={detailCourse}
          progress={courseData[detailCourse.courseId]}
          open={!!detailCourse}
          onOpenChange={(open) => { if (!open) setDetailCourse(null); }}
        />
      )}
    </div>
  );
}

function CourseDetailDialog({ course, progress, open, onOpenChange }) {
  const pct = progress?.status === 'completed' ? 100 : (progress?.progress != null ? progress.progress * 10 : null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{course.name}</DialogTitle>
          {course.description && (
            <DialogDescription>{course.description}</DialogDescription>
          )}
        </DialogHeader>

        {pct != null && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
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
          <p className="text-sm text-muted-foreground leading-relaxed">{course.exemplar}</p>
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-medium">Learning Objectives</h3>
          <ul className="list-disc pl-5 text-sm text-muted-foreground leading-relaxed space-y-1">
            {course.learningObjectives.map((obj, i) => (
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
