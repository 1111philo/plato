import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';

export default function Home() {
  const [activeCount, setActiveCount] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    document.title = 'Home - Learn Service';
    loadStats();
  }, []);

  async function loadStats() {
    const [participants, invites] = await Promise.all([
      api('GET', '/v1/admin/participants'),
      api('GET', '/v1/admin/invites'),
    ]);
    setActiveCount(participants._error ? 0 : participants.length);
    setPendingCount(
      invites._error ? 0 : invites.filter((i) => i.status === 'pending').length
    );
  }

  return (
    <div aria-live="polite">
      <div style={{ margin: '40px 0 24px', textAlign: 'center' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: 8 }}>
          Welcome to Learn Service
        </h1>
        <p style={{ color: 'var(--color-text-secondary)' }}>
          Manage participants and settings for 1111 Learn.
        </p>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 16,
          maxWidth: 400,
          margin: '0 auto',
        }}
      >
        <Link
          className="card centered"
          to="/participants"
          aria-label={`View ${activeCount} active participants`}
          style={{ cursor: 'pointer', textDecoration: 'none', color: 'inherit', display: 'block' }}
        >
          <div style={{ fontSize: '2rem', fontWeight: 800 }}>{activeCount}</div>
          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
            Active participants
          </div>
        </Link>
        <Link
          className="card centered"
          to="/participants"
          aria-label={`View ${pendingCount} pending invites`}
          style={{ cursor: 'pointer', textDecoration: 'none', color: 'inherit', display: 'block' }}
        >
          <div style={{ fontSize: '2rem', fontWeight: 800 }}>{pendingCount}</div>
          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
            Pending invites
          </div>
        </Link>
      </div>
    </div>
  );
}
