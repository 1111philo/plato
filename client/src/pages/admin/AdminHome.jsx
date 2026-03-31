import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from './adminApi.js';

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
      <h1>Dashboard</h1>
      <p className="admin-subtitle">Manage participants and settings for plato.</p>
      <div className="admin-stats">
        <Link className="admin-stat-card" to="/plato-admin/participants">
          <div className="admin-stat-number">{activeCount}</div>
          <div className="admin-stat-label">Active participants</div>
        </Link>
        <Link className="admin-stat-card" to="/plato-admin/participants">
          <div className="admin-stat-number">{pendingCount}</div>
          <div className="admin-stat-label">Pending invites</div>
        </Link>
      </div>
    </div>
  );
}
