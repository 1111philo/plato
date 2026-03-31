import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from './adminApi.js';
import { Card, CardContent } from '@/components/ui/card';

export default function AdminHome() {
  const [activeCount, setActiveCount] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    document.title = 'Admin — plato';
    Promise.all([
      adminApi('GET', '/v1/admin/participants'),
      adminApi('GET', '/v1/admin/invites'),
    ]).then(([participants, invites]) => {
      setActiveCount(Array.isArray(participants) ? participants.length : 0);
      setPendingCount(Array.isArray(invites) ? invites.filter(i => i.status === 'pending').length : 0);
    }).catch(() => {});
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Dashboard</h1>
      <p className="text-muted-foreground mb-6">Manage participants and settings for plato.</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Link to="/plato-admin/participants" className="no-underline">
          <Card className="hover:ring-2 hover:ring-primary/30 transition-shadow cursor-pointer">
            <CardContent>
              <div className="text-3xl font-bold">{activeCount}</div>
              <div className="text-sm text-muted-foreground">Active participants</div>
            </CardContent>
          </Card>
        </Link>
        <Link to="/plato-admin/participants" className="no-underline">
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
