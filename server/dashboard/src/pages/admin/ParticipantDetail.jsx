import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api, fetchAffiliations } from '../../api';
import Alert from '../../components/Alert';
import Spinner from '../../components/Spinner';
export default function ParticipantDetail() {
  const { userId } = useParams();
  const navigate = useNavigate();
  const [participant, setParticipant] = useState(null);
  const [affiliations, setAffiliations] = useState([]);
  const [role, setRole] = useState('');
  const [affiliation, setAffiliation] = useState('');
  const [alert, setAlert] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.title = 'Participant - Learn Service';
    loadData();
  }, [userId]);

  async function loadData() {
    setLoading(true);
    const [data, affData] = await Promise.all([
      api('GET', '/v1/admin/participants/' + userId),
      fetchAffiliations(),
    ]);
    if (data._error) {
      setAlert({ message: data._error, type: 'error' });
      setLoading(false);
      return;
    }
    setParticipant(data);
    setRole(data.role || 'participant');
    setAffiliation(data.affiliation || '');
    setAffiliations(affData);
    setLoading(false);
  }

  async function handleRoleChange(newRole) {
    setRole(newRole);
    const data = await api('PUT', '/v1/admin/participants/' + userId + '/role', { role: newRole });
    if (data._error) {
      setAlert({ message: data._error, type: 'error' });
      return;
    }
    setAlert({ message: 'Role updated to ' + newRole + '.', type: 'success' });
  }

  async function handleAffiliationChange(newAff) {
    setAffiliation(newAff);
    const data = await api('PATCH', '/v1/admin/participants/' + userId, {
      affiliation: newAff || null,
    });
    if (data._error) {
      setAlert({ message: data._error, type: 'error' });
      return;
    }
    setAlert({ message: 'Affiliation updated.', type: 'success' });
  }

  function handleDeleteParticipant() {
    if (!participant) return;
    if (window.confirm('Remove ' + participant.name + ' and all their data? This cannot be undone.')) {
      deleteParticipant();
    }
  }

  async function deleteParticipant() {
    const data = await api('DELETE', '/v1/admin/participants/' + userId);
    if (data._error) {
      setAlert({ message: data._error, type: 'error' });
      return;
    }
    navigate('/participants');
  }

  if (loading) {
    return (
      <div className="empty">
        <Spinner /> Loading...
      </div>
    );
  }

  if (!participant) {
    return (
      <>
        <Link className="back-link" to="/participants">
          &larr; Back to participants
        </Link>
        <Alert message={alert?.message} type={alert?.type} onDismiss={() => setAlert(null)} />
      </>
    );
  }

  return (
    <div aria-live="polite">
      <Link className="back-link" to="/participants">
        &larr; Back to participants
      </Link>
      <Alert message={alert?.message} type={alert?.type} onDismiss={() => setAlert(null)} />
      <div className="card">
        <h2>{participant.name}</h2>
        <div className="detail-row">
          <span className="detail-label">Email</span>
          <span className="detail-value">{participant.email}</span>
        </div>
        <div className="detail-row">
          <span className="detail-label">Affiliation</span>
          <span className="detail-value">
            <label htmlFor="pk-affiliation" className="sr-only">Affiliation</label>
            <select
              id="pk-affiliation"
              style={{
                padding: '4px 8px',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius)',
                fontSize: 13,
              }}
              value={affiliation}
              onChange={(e) => handleAffiliationChange(e.target.value)}
            >
              <option value="">None</option>
              {affiliations.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </span>
        </div>
        <div className="detail-row">
          <span className="detail-label">Role</span>
          <span className="detail-value">
            <label htmlFor="pk-role" className="sr-only">Role</label>
            <select
              id="pk-role"
              style={{
                padding: '4px 8px',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius)',
                fontSize: 13,
              }}
              value={role}
              onChange={(e) => handleRoleChange(e.target.value)}
            >
              <option value="participant">Participant</option>
              <option value="admin">Admin</option>
            </select>
          </span>
        </div>
        <div className="detail-row">
          <span className="detail-label">Joined</span>
          <span className="detail-value">
            {new Date(participant.createdAt).toLocaleDateString()}
          </span>
        </div>
        <div className="btn-row" style={{ marginTop: 20 }}>
          <button className="danger-btn" onClick={handleDeleteParticipant}>
            Remove participant
          </button>
        </div>
      </div>
    </div>
  );
}
