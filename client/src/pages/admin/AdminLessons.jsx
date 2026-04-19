import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { adminApi } from './adminApi.js';
import { Button } from '@/components/ui/button';

export default function AdminLessons() {
  const [lessons, setLessons] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    document.title = 'Lessons — plato';
    adminApi('GET', '/v1/admin/lessons')
      .then(data => {
        setLessons(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  function statusBadge(status) {
    if (status === 'public') {
      return <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">Public</span>;
    }
    return <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">Private</span>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold mb-1">Lessons</h1>
          <p className="text-muted-foreground">Manage microlearning lessons.</p>
        </div>
        <Button onClick={() => navigate('/plato/lessons/new')}>New lesson</Button>
      </div>

      {loading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : lessons.length === 0 ? (
        <p className="text-muted-foreground">No lessons yet. Create your first lesson to get started.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="pb-2 pr-4 font-medium">Name</th>
                <th className="pb-2 pr-4 font-medium">Status</th>
                <th className="pb-2 pr-4 font-medium">Updated by</th>
                <th className="pb-2 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody>
              {lessons.map(lesson => (
                <tr key={lesson.lessonId} className="border-b last:border-0 hover:bg-muted/40 transition-colors">
                  <td className="py-3 pr-4">
                    <Link
                      to={`/plato/lessons/${lesson.lessonId}`}
                      className="font-medium hover:underline"
                    >
                      {lesson.name || lesson.lessonId}
                    </Link>
                  </td>
                  <td className="py-3 pr-4">{statusBadge(lesson.status)}</td>
                  <td className="py-3 pr-4 text-muted-foreground">{lesson.updatedBy || lesson.createdBy || '—'}</td>
                  <td className="py-3 text-muted-foreground">
                    {lesson.updatedAt
                      ? new Date(lesson.updatedAt).toLocaleDateString()
                      : lesson.createdAt
                        ? new Date(lesson.createdAt).toLocaleDateString()
                        : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
