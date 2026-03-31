import { useState, useEffect } from 'react';
import { adminApi } from './adminApi.js';

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

  if (loading) return <div className="admin-loading">Loading...</div>;

  if (editing) {
    return (
      <div>
        <h1>{editing.isNew ? 'New Course' : `Edit: ${editing.name}`}</h1>
        <div className="admin-card">
          <div className="form-group">
            <label htmlFor="course-name">Course Name</label>
            <input id="course-name" type="text" value={editing.name}
              onChange={e => setEditing({ ...editing, name: e.target.value })} />
          </div>
          <div className="form-group">
            <label htmlFor="course-md">Course Markdown</label>
            <textarea id="course-md" className="admin-code-editor" rows={20}
              value={editing.markdown}
              onChange={e => setEditing({ ...editing, markdown: e.target.value })} />
          </div>
          <div className="admin-btn-row">
            <button className="primary-btn" onClick={saveCourse}>Save</button>
            <button className="secondary-btn" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1>Courses</h1>
      {message && (
        <div className={`admin-alert admin-alert-${message.type}`} role="alert">
          {message.text}
          <button onClick={() => setMessage(null)} aria-label="Dismiss">&times;</button>
        </div>
      )}
      <button className="primary-btn" style={{ marginBottom: 16 }}
        onClick={() => setEditing({ courseId: '', name: '', markdown: '', isNew: true })}>
        Add Course
      </button>
      <div className="admin-card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="admin-table" aria-label="Courses">
          <thead><tr><th>Name</th><th>Updated</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {courses.map(c => (
              <tr key={c.courseId}>
                <td>{c.name || c.courseId}</td>
                <td>{c.updatedAt ? new Date(c.updatedAt).toLocaleDateString() : '—'}</td>
                <td>
                  <button className="admin-icon-btn" title="Edit" onClick={() => editCourse(c.courseId)}>&#9998;</button>
                  <button className="admin-icon-btn" title="Delete" onClick={() => deleteCourse(c.courseId)}>&#10005;</button>
                </td>
              </tr>
            ))}
            {courses.length === 0 && <tr><td colSpan={3} style={{ textAlign: 'center', padding: 24 }}>No courses yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
