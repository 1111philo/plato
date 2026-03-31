import { useState, useEffect } from 'react';
import { adminApi } from './adminApi.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';

export default function AdminCourses() {
  const [courses, setCourses] = useState([]);
  const [editing, setEditing] = useState(null); // { courseId, name, markdown, isNew }
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.title = 'Courses — Admin';
    loadCourses();
  }, []);

  async function loadCourses() {
    setLoading(true);
    try {
      const data = await adminApi('GET', '/v1/admin/courses');
      setCourses(Array.isArray(data) ? data : []);
    } catch { /* ignore */ }
    setLoading(false);
  }

  async function editCourse(courseId) {
    try {
      const data = await adminApi('GET', `/v1/admin/courses/${encodeURIComponent(courseId)}`);
      setEditing({ courseId, name: data.name || courseId, markdown: data.markdown || '', isNew: false });
    } catch (e) { setMessage({ text: e.message, type: 'error' }); }
  }

  async function saveCourse() {
    if (!editing) return;
    const courseId = editing.isNew ? editing.name.trim().replace(/\s+/g, '-').toLowerCase() : editing.courseId;
    try {
      await adminApi('PUT', `/v1/admin/courses/${encodeURIComponent(courseId)}`, {
        markdown: editing.markdown,
        name: editing.name,
      });
      setMessage({ text: 'Course saved.', type: 'success' });
      setEditing(null);
      loadCourses();
    } catch (e) { setMessage({ text: e.message, type: 'error' }); }
  }

  async function deleteCourse(courseId) {
    if (!confirm(`Delete course "${courseId}"?`)) return;
    try {
      await adminApi('DELETE', `/v1/admin/courses/${encodeURIComponent(courseId)}`);
      setMessage({ text: 'Course deleted.', type: 'success' });
      loadCourses();
    } catch (e) { setMessage({ text: e.message, type: 'error' }); }
  }

  if (loading) return <div className="flex items-center justify-center py-12 text-muted-foreground">Loading...</div>;

  if (editing) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-4">{editing.isNew ? 'New Course' : `Edit: ${editing.name}`}</h1>
        <Card>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="course-name">Course Name</Label>
              <Input
                id="course-name"
                type="text"
                value={editing.name}
                onChange={e => setEditing({ ...editing, name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="course-md">Course Markdown</Label>
              <Textarea
                id="course-md"
                className="font-mono text-sm min-h-[400px]"
                rows={20}
                value={editing.markdown}
                onChange={e => setEditing({ ...editing, markdown: e.target.value })}
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={saveCourse}>Save</Button>
              <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Courses</h1>

      {message && (
        <div
          className={`flex items-center justify-between rounded-lg px-4 py-3 mb-4 text-sm ${
            message.type === 'error'
              ? 'bg-destructive/10 text-destructive'
              : 'bg-green-50 text-green-800 dark:bg-green-900/20 dark:text-green-400'
          }`}
          role="alert"
        >
          <span>{message.text}</span>
          <button onClick={() => setMessage(null)} aria-label="Dismiss" className="ml-2 text-lg leading-none hover:opacity-70">&times;</button>
        </div>
      )}

      <Button className="mb-4" onClick={() => setEditing({ courseId: '', name: '', markdown: '', isNew: true })}>
        Add Course
      </Button>

      <Card className="p-0 overflow-hidden">
        <Table aria-label="Courses">
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead><span className="sr-only">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {courses.map(c => (
              <TableRow key={c.courseId}>
                <TableCell>{c.name || c.courseId}</TableCell>
                <TableCell>{c.updatedAt ? new Date(c.updatedAt).toLocaleDateString() : '\u2014'}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon-xs" title="Edit" onClick={() => editCourse(c.courseId)}>&#9998;</Button>
                    <Button variant="ghost" size="icon-xs" title="Delete" onClick={() => deleteCourse(c.courseId)}>&#10005;</Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {courses.length === 0 && (
              <TableRow>
                <TableCell colSpan={3} className="text-center py-6 text-muted-foreground">No courses yet.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
