import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from './adminApi.js';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

function statusVariant(status) {
  if (status === 'public') return 'default';
  return 'secondary';
}

export default function AdminLessons() {
  const [lessons, setLessons] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.title = 'Lessons — plato';
    adminApi('GET', '/v1/admin/lessons')
      .then((data) => setLessons(Array.isArray(data) ? data : []))
      .catch(() => setLessons([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold mb-1">Lessons</h1>
          <p className="text-muted-foreground">All lessons in this classroom.</p>
        </div>
        <Link to="/lessons/create">
          <Button>Create lesson</Button>
        </Link>
      </div>

      {loading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : lessons.length === 0 ? (
        <p className="text-muted-foreground">No lessons yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Updated by</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lessons.map((lesson) => (
              <TableRow key={lesson.lessonId}>
                <TableCell className="font-medium">
                  <Link to={`/plato/lessons/${lesson.lessonId}`} className="hover:underline">
                    {lesson.name || lesson.lessonId}
                  </Link>
                </TableCell>
                <TableCell>
                  <Badge variant={statusVariant(lesson.status)}>
                    {lesson.status === 'public' ? 'Public' : 'Private'}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {lesson.updatedBy || lesson.createdBy || '—'}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {lesson.createdAt
                    ? new Date(lesson.createdAt).toLocaleDateString()
                    : '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
