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
const DESC_MAX = 500;

function newCourseId() {
  return `course-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Modal for managing courses. Mirrors the User Groups modal pattern in
 * AdminUsers.jsx but accommodates an optional course description by
 * combining a small inline create/edit form with a list of existing
 * courses below it.
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
  const [formDescription, setFormDescription] = useState('');
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
    setFormDescription('');
    setError('');
  }

  function startEdit(course) {
    setEditingId(course.courseId);
    setFormName(course.name || '');
    setFormDescription(course.description || '');
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
    if (formDescription.length > DESC_MAX) {
      setError(`Description must be ${DESC_MAX} characters or fewer.`);
      return;
    }
    const targetId = editingId || newCourseId();
    const wasEdit = !!editingId;
    try {
      await adminApi('PUT', `/v1/admin/courses/${encodeURIComponent(targetId)}`, {
        name: trimmedName,
        description: formDescription,
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
              Group lessons under named courses. The coach receives the course name and description as part of its context when a lesson is assigned to one.
            </DialogDescription>
          </DialogHeader>

          <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
            {announcement}
          </div>

          <div className="space-y-4">
            <form
              className="space-y-3 rounded-md border border-input bg-muted/30 p-3"
              onSubmit={(e) => { e.preventDefault(); saveCourse(); }}
              aria-label={editingId ? 'Edit course' : 'Add course'}
            >
              <div className="space-y-1">
                <Label htmlFor="course-form-name">Name</Label>
                <Input
                  id="course-form-name"
                  type="text"
                  value={formName}
                  maxLength={NAME_MAX}
                  onChange={(e) => setFormName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="course-form-description">Description (optional)</Label>
                <textarea
                  id="course-form-description"
                  className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  rows={3}
                  value={formDescription}
                  maxLength={DESC_MAX}
                  onChange={(e) => setFormDescription(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">{formDescription.length}/{DESC_MAX}</p>
              </div>
              {error && (
                <p role="alert" className="text-sm text-destructive">{error}</p>
              )}
              <div className="flex items-center justify-end gap-2">
                {editingId && (
                  <Button type="button" variant="ghost" onClick={resetForm}>Cancel</Button>
                )}
                <Button type="submit">{editingId ? 'Save' : 'Add Course'}</Button>
              </div>
            </form>

            <div>
              <h3 className="text-sm font-medium mb-2">Existing courses</h3>
              {loading ? (
                <p className="text-sm text-muted-foreground" role="status" aria-live="polite">Loading…</p>
              ) : courses.length === 0 ? (
                <p className="text-sm text-muted-foreground">No courses yet.</p>
              ) : (
                <ul className="space-y-1" aria-label="Course list">
                  {courses.map((c) => (
                    <li
                      key={c.courseId}
                      className={`flex items-start justify-between gap-3 rounded-md px-3 py-2 ${editingId === c.courseId ? 'bg-primary/10' : 'bg-muted/50'}`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">{c.name}</div>
                        {c.description && (
                          <div className="text-xs text-muted-foreground line-clamp-2">{c.description}</div>
                        )}
                        <div className="text-xs text-muted-foreground/80 mt-0.5">{c.lessonCount} lesson{c.lessonCount === 1 ? '' : 's'}</div>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <Button variant="ghost" size="icon-xs" title="Edit" aria-label={`Edit course ${c.name}`} onClick={() => startEdit(c)}>&#9998;</Button>
                        <Button variant="ghost" size="icon-xs" title="Delete" aria-label={`Delete course ${c.name}`} onClick={() => deleteCourse(c)}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
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
