import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from './adminApi.js';
import { Card, CardContent } from '@/components/ui/card';

export default function AdminHome() {
  const [activeCount, setActiveCount] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [contentUpdateCount, setContentUpdateCount] = useState(0);

  useEffect(() => {
    document.title = 'Admin — plato';
    Promise.all([
      adminApi('GET', '/v1/admin/users'),
      adminApi('GET', '/v1/admin/invites'),
      adminApi('GET', '/v1/admin/content-updates'),
    ]).then(([users, invites, contentUpdates]) => {
      setActiveCount(Array.isArray(users) ? users.length : 0);
      setPendingCount(Array.isArray(invites) ? invites.filter(i => i.status === 'pending').length : 0);
      setContentUpdateCount(contentUpdates?.count || 0);
    }).catch(() => {});
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Dashboard</h1>
      <p className="text-muted-foreground mb-6">Manage users and settings for plato.</p>

      {contentUpdateCount > 0 && (
        <Link to="/plato/content-updates" className="block no-underline mb-6">
          <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 hover:bg-blue-100 transition-colors" role="alert">
            <strong>{contentUpdateCount} content update{contentUpdateCount !== 1 ? 's' : ''} available</strong> from the latest version of plato.{' '}
            <span className="underline">Review updates</span>
          </div>
        </Link>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Link to="/plato/users" className="no-underline">
          <Card className="hover:ring-2 hover:ring-primary/30 transition-shadow cursor-pointer">
            <CardContent>
              <div className="text-3xl font-bold">{activeCount}</div>
              <div className="text-sm text-muted-foreground">Active users</div>
            </CardContent>
          </Card>
        </Link>
        <Link to="/plato/users" className="no-underline">
          <Card className="hover:ring-2 hover:ring-primary/30 transition-shadow cursor-pointer">
            <CardContent>
              <div className="text-3xl font-bold">{pendingCount}</div>
              <div className="text-sm text-muted-foreground">Pending invites</div>
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
