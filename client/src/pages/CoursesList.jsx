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

  const CourseIcon = ({ children }) => (
    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs text-primary" aria-hidden="true">
      {children}
    </span>
  );

  const CourseItem = ({ index, onClick, dashed, children }) => (
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
      <h2 className="text-xl font-semibold mb-4">Courses</h2>
      <ul className="space-y-3" role="list">
        {courses.map((c, i) => (
          <CourseItem key={c.courseId} index={i} onClick={() => navigate(`/courses/${c.courseId}`)}>
            <CourseIcon>{statusIcon(c.courseId)}</CourseIcon>
            <div className="min-w-0 flex-1 space-y-1">
              <strong className="text-sm font-medium">{c.name}</strong>
              {c.description && <p className="text-sm text-muted-foreground line-clamp-2">{c.description}</p>}
              <div className="flex items-center gap-2 flex-wrap">
                {c.courseId.startsWith('custom-') && <Badge variant="outline" className="text-xs">My Course</Badge>}
                {progressLabel(c) && <Badge variant="secondary" className="text-xs">{progressLabel(c)}</Badge>}
                <button className="text-xs text-primary hover:underline"
                  onClick={(e) => { e.stopPropagation(); setDetailCourse(c); }}>
                  {c.learningObjectives.length} objectives
                </button>
              </div>
            </div>
          </CourseItem>
        ))}

        <CourseItem index={courses.length} onClick={() => navigate('/courses/create')} dashed>
          <CourseIcon>+</CourseIcon>
          <div className="min-w-0 flex-1 space-y-1">
            <strong className="text-sm font-medium">{hasDraft ? 'Continue Course Draft' : 'Create Your Own Course'}</strong>
            <p className="text-sm text-muted-foreground">{hasDraft ? 'Resume designing your course' : 'Design a custom course with AI guidance'}</p>
          </div>
        </CourseItem>

      </ul>

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
          <div
            className="space-y-1"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            aria-label={`Course progress: ${pct}%`}
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
