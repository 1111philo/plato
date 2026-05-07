import { useState, useEffect } from 'react';
import { adminApi } from './adminApi.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import ConfirmModal from '../../components/modals/ConfirmModal.jsx';

const NAME_MAX = 80;

function newCourseId() {
  return `course-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Modal for managing courses. Mirrors the User Groups modal pattern in
 * AdminUsers.jsx — small inline create/edit form on top, list of
 * existing courses below it.
 *
 * The parent should call `onMutated` after a successful add / edit /
 * delete so that any list (e.g. the lessons-list course-name lookup or
 * the lesson editor's dropdown) re-fetches.
 */
export default function CoursesModal({ open, onOpenChange, onMutated }) {
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState(null); // null = add mode, course id = edit mode
  const [formName, setFormName] = useState('');
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(null);
  // sr-only announcement that updates after each successful mutation so
  // screen readers hear "Course added/updated/deleted" without us moving
  // focus or showing a separate toast inside the modal.
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    if (open) {
      loadCourses();
      resetForm();
    }
  }, [open]);

  async function loadCourses() {
    setLoading(true);
    try {
      const data = await adminApi('GET', '/v1/admin/courses');
      setCourses(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e.message || 'Failed to load courses.');
    }
    setLoading(false);
  }

  function resetForm() {
    setEditingId(null);
    setFormName('');
    setError('');
  }

  function startEdit(course) {
    setEditingId(course.courseId);
    setFormName(course.name || '');
    setError('');
  }

  async function saveCourse() {
    setError('');
    const trimmedName = formName.trim();
    if (!trimmedName) {
      setError('Course name is required.');
      return;
    }
    if (trimmedName.length > NAME_MAX) {
      setError(`Course name must be ${NAME_MAX} characters or fewer.`);
      return;
    }
    const targetId = editingId || newCourseId();
    const wasEdit = !!editingId;
    try {
      await adminApi('PUT', `/v1/admin/courses/${encodeURIComponent(targetId)}`, {
        name: trimmedName,
      });
      resetForm();
      await loadCourses();
      onMutated?.();
      setAnnouncement('');
      requestAnimationFrame(() => setAnnouncement(wasEdit ? 'Course updated.' : 'Course added.'));
    } catch (e) {
      setError(e.message || 'Failed to save course.');
    }
  }

  function deleteCourse(course) {
    const lessonNote = course.lessonCount
      ? ` It is currently assigned to ${course.lessonCount} lesson${course.lessonCount === 1 ? '' : 's'}; those lessons will be left without a course.`
      : '';
    setConfirm({
      title: `Delete "${course.name}"?`,
      message: `This will permanently delete the course.${lessonNote}`,
      confirmLabel: 'Delete Course',
      onConfirm: async () => {
        try {
          await adminApi('DELETE', `/v1/admin/courses/${encodeURIComponent(course.courseId)}`);
          // If we were editing the course we just deleted, reset the form.
          if (editingId === course.courseId) resetForm();
          await loadCourses();
          onMutated?.();
          setAnnouncement('');
          requestAnimationFrame(() => setAnnouncement('Course deleted.'));
        } catch (e) {
          setError(e.message || 'Failed to delete course.');
        }
      },
    });
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Courses</DialogTitle>
            <DialogDescription>
              Group lessons under named courses. The coach receives the course name as part of its context when a lesson is assigned to one.
            </DialogDescription>
          </DialogHeader>

          <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
            {announcement}
          </div>

          <div className="space-y-4">
            <form
              className="flex gap-2"
              onSubmit={(e) => { e.preventDefault(); saveCourse(); }}
              aria-label={editingId ? 'Edit course' : 'Add course'}
            >
              <Label htmlFor="course-form-name" className="sr-only">Course name</Label>
              <Input
                id="course-form-name"
                type="text"
                placeholder="Course name"
                value={formName}
                maxLength={NAME_MAX}
                onChange={(e) => setFormName(e.target.value)}
                required
                className="flex-1"
              />
              {editingId && (
                <Button type="button" variant="ghost" onClick={resetForm}>Cancel</Button>
              )}
              <Button type="submit">{editingId ? 'Save' : 'Add Course'}</Button>
            </form>
            {error && (
              <p role="alert" className="text-sm text-destructive">{error}</p>
            )}

            {loading ? (
              <p className="text-sm text-muted-foreground" role="status" aria-live="polite">Loading…</p>
            ) : courses.length === 0 ? (
              <p className="text-sm text-muted-foreground">No courses yet.</p>
            ) : (
              <ul className="space-y-1" aria-label="Course list">
                {courses.map((c) => (
                  <li
                    key={c.courseId}
                    className={`flex items-center justify-between gap-2 rounded-md px-3 py-2 ${editingId === c.courseId ? 'bg-primary/10' : 'bg-muted/50'}`}
                  >
                    <span className="text-sm flex-1 truncate">
                      {c.name}
                      <span className="text-xs text-muted-foreground ml-2">({c.lessonCount} lesson{c.lessonCount === 1 ? '' : 's'})</span>
                    </span>
                    <div className="flex gap-1 shrink-0">
                      <Button variant="ghost" size="icon-xs" title="Rename" aria-label={`Rename course ${c.name}`} onClick={() => startEdit(c)}>&#9998;</Button>
                      <Button variant="ghost" size="icon-xs" title="Delete" aria-label={`Delete course ${c.name}`} onClick={() => deleteCourse(c)}>&#10005;</Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {confirm && (
        <ConfirmModal
          open={!!confirm}
          onOpenChange={(open) => { if (!open) setConfirm(null); }}
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.confirmLabel}
          onConfirm={() => { setConfirm(null); confirm.onConfirm(); }}
        />
      )}
    </>
  );
}
