import { useState, useEffect } from 'react';
import { adminApi } from './adminApi.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import ConfirmModal from '../../components/modals/ConfirmModal.jsx';

const NAME_MAX = 80;
const DESC_MAX = 500;

function newCourseId() {
  return `course-${Math.random().toString(36).slice(2, 10)}`;
}

export default function AdminCourses() {
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // { courseId, name, description, isCreate }
  const [confirmModal, setConfirmModal] = useState(null);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    document.title = 'Courses — Admin';
    loadCourses();
  }, []);

  async function loadCourses() {
    setLoading(true);
    try {
      const data = await adminApi('GET', '/v1/admin/courses');
      setCourses(Array.isArray(data) ? data : []);
    } catch (e) {
      setMessage({ text: e.message, type: 'error' });
    }
    setLoading(false);
  }

  function openCreate() {
    setEditing({ courseId: newCourseId(), name: '', description: '', isCreate: true });
  }

  function openEdit(course) {
    setEditing({
      courseId: course.courseId,
      name: course.name || '',
      description: course.description || '',
      isCreate: false,
    });
  }

  async function saveCourse() {
    if (!editing) return;
    const trimmedName = editing.name.trim();
    if (!trimmedName) {
      setMessage({ text: 'Course name is required.', type: 'error' });
      return;
    }
    if (trimmedName.length > NAME_MAX) {
      setMessage({ text: `Course name must be ${NAME_MAX} characters or fewer.`, type: 'error' });
      return;
    }
    if (editing.description.length > DESC_MAX) {
      setMessage({ text: `Description must be ${DESC_MAX} characters or fewer.`, type: 'error' });
      return;
    }
    try {
      await adminApi('PUT', `/v1/admin/courses/${encodeURIComponent(editing.courseId)}`, {
        name: trimmedName,
        description: editing.description,
      });
      setMessage({ text: editing.isCreate ? 'Course created.' : 'Course updated.', type: 'success' });
      setEditing(null);
      loadCourses();
    } catch (e) {
      setMessage({ text: e.message, type: 'error' });
    }
  }

  function deleteCourse(course) {
    const lessonNote = course.lessonCount
      ? ` It is currently assigned to ${course.lessonCount} lesson${course.lessonCount === 1 ? '' : 's'}; those lessons will be left without a course.`
      : '';
    setConfirmModal({
      title: `Delete "${course.name}"?`,
      message: `This will permanently delete the course.${lessonNote}`,
      confirmLabel: 'Delete Course',
      onConfirm: async () => {
        try {
          await adminApi('DELETE', `/v1/admin/courses/${encodeURIComponent(course.courseId)}`);
          setMessage({ text: 'Course deleted.', type: 'success' });
          loadCourses();
        } catch (e) {
          setMessage({ text: e.message, type: 'error' });
        }
      },
    });
  }

  if (loading) {
    return <div className="flex items-center justify-center py-12 text-muted-foreground" role="status" aria-live="polite">Loading...</div>;
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Courses</h1>

      {message && (
        <div
          className={`flex items-center justify-between rounded-lg px-4 py-3 mb-4 text-sm ${
            message.type === 'error'
              ? 'bg-destructive/10 text-destructive'
              : 'bg-green-50 text-green-800'
          }`}
          role="alert"
        >
          <span>{message.text}</span>
          <button onClick={() => setMessage(null)} aria-label="Dismiss" className="ml-2 text-lg leading-none hover:opacity-70">&times;</button>
        </div>
      )}

      <Button className="mb-4" onClick={openCreate}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        New Course
      </Button>

      <Card className="p-0 overflow-hidden">
        <Table aria-label="Courses">
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Lessons</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead><span className="sr-only">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {courses.map((c) => (
              <TableRow key={c.courseId}>
                <TableCell className="font-medium">{c.name}</TableCell>
                <TableCell className="text-muted-foreground max-w-md">
                  <span className="line-clamp-2">{c.description || <span className="italic text-muted-foreground/70">No description</span>}</span>
                </TableCell>
                <TableCell className="text-muted-foreground tabular-nums">{c.lessonCount}</TableCell>
                <TableCell>{c.updatedAt ? new Date(c.updatedAt).toLocaleDateString() : '—'}</TableCell>
                <TableCell>
                  <div className="flex gap-1" role="group" aria-label={`Actions for ${c.name}`}>
                    <Button variant="ghost" size="icon-xs" title="Edit" aria-label={`Edit ${c.name}`} onClick={() => openEdit(c)}>&#9998;</Button>
                    <Button variant="ghost" size="icon-xs" title="Delete" aria-label={`Delete ${c.name}`} onClick={() => deleteCourse(c)}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {courses.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-6 text-muted-foreground">No courses yet. Click &ldquo;New Course&rdquo; to add one.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      {editing && (
        <Dialog open={!!editing} onOpenChange={(open) => { if (!open) setEditing(null); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editing.isCreate ? 'New Course' : 'Edit Course'}</DialogTitle>
              <DialogDescription>Group related lessons under a named course. The coach receives the course name and description as part of its context.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="course-name">Name</Label>
                <Input
                  id="course-name"
                  type="text"
                  value={editing.name}
                  maxLength={NAME_MAX}
                  onChange={(e) => setEditing((prev) => ({ ...prev, name: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter') saveCourse(); }}
                  autoFocus
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="course-description">Description (optional)</Label>
                <textarea
                  id="course-description"
                  className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  rows={4}
                  value={editing.description}
                  maxLength={DESC_MAX}
                  onChange={(e) => setEditing((prev) => ({ ...prev, description: e.target.value }))}
                />
                <p className="text-xs text-muted-foreground">{editing.description.length}/{DESC_MAX}</p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
              <Button onClick={saveCourse}>{editing.isCreate ? 'Create' : 'Save'}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {confirmModal && (
        <ConfirmModal
          open={!!confirmModal}
          onOpenChange={(open) => { if (!open) setConfirmModal(null); }}
          title={confirmModal.title}
          message={confirmModal.message}
          confirmLabel={confirmModal.confirmLabel}
          onConfirm={() => { setConfirmModal(null); confirmModal.onConfirm(); }}
        />
      )}
    </div>
  );
}
