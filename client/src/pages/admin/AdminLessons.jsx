import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from './adminApi.js';
import { Button } from '@/components/ui/button';

export default function AdminLessons() {
  const [lessons, setLessons] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.title = 'Lessons — plato Admin';
    adminApi('GET', '/v1/admin/lessons')
      .then(data => {
        setLessons(Array.isArray(data) ? data : []);
      })
      .catch(() => setLessons([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-muted-foreground">Loading…</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold mb-1">Lessons</h1>
          <p className="text-muted-foreground">All lessons in this classroom.</p>
        </div>
        <Link to="/plato/lessons/new">
          <Button>New lesson</Button>
        </Link>
      </div>

      {lessons.length === 0 ? (
        <div className="text-muted-foreground">No lessons yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2 pr-4 font-medium">Name</th>
                <th className="text-left py-2 pr-4 font-medium">Status</th>
                <th className="text-left py-2 pr-4 font-medium">Updated by</th>
                <th className="text-left py-2 pr-4 font-medium">Updated</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lessons.map(lesson => (
                <tr key={lesson.lessonId} className="border-b hover:bg-muted/30">
                  <td className="py-2 pr-4 font-medium">
                    <Link to={`/plato/lessons/${lesson.lessonId}`} className="hover:underline">
                      {lesson.name || lesson.lessonId}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                      lesson.status === 'public'
                        ? 'bg-green-100 text-green-800'
                        : 'bg-gray-100 text-gray-700'
                    }`}>
                      {lesson.status === 'public' ? 'Public' : 'Private'}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-muted-foreground">
                    {lesson.updatedBy || '—'}
                  </td>
                  <td className="py-2 pr-4 text-muted-foreground">
                    {lesson.updatedAt
                      ? new Date(lesson.updatedAt).toLocaleDateString()
                      : '—'}
                  </td>
                  <td className="py-2 text-right">
                    <Link to={`/plato/lessons/${lesson.lessonId}`}>
                      <Button variant="ghost" size="sm">Edit</Button>
                    </Link>
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
