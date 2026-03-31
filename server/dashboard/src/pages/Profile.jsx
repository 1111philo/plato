import { useState, useEffect } from 'react';
import { useAuth } from '../auth';
import { api, fetchAffiliations } from '../api';
import Alert from '../components/Alert';
import Spinner from '../components/Spinner';
import PasswordInput from '../components/PasswordInput';

export default function Profile() {
  const { auth, updateUser, logout } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [affiliation, setAffiliation] = useState('');
  const [password, setPassword] = useState('');
  const [affiliations, setAffiliations] = useState([]);
  const [alert, setAlert] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteInput, setDeleteInput] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState(null);
  const [resettingSync, setResettingSync] = useState(false);

  useEffect(() => {
    document.title = 'My Profile - Learn Service';
    loadProfile();
  }, []);

  async function loadProfile() {
    setLoading(true);
    const [data, affData, syncData] = await Promise.all([
      api('GET', '/v1/me'),
      fetchAffiliations(),
      api('GET', '/v1/sync'),
    ]);
    if (!data._error) {
      setName(data.name || '');
      setEmail(data.email || '');
      setAffiliation(data.affiliation || '');
    }
    if (!syncData._error && Array.isArray(syncData) && syncData.length > 0) {
      const latest = syncData.reduce((max, item) => {
        return item.updatedAt > max ? item.updatedAt : max;
      }, '');
      setLastSyncTime(latest || null);
    } else {
      setLastSyncTime(null);
    }
    setAffiliations(affData);
    setLoading(false);
  }

  async function handleSave() {
    const updates = {};
    if (name.trim()) updates.name = name.trim();
    if (email.trim()) updates.email = email.trim();
    updates.affiliation = affiliation;
    if (password) {
      if (password.length < 8) {
        setAlert({ message: 'Password must be at least 8 characters.', type: 'error' });
        return;
      }
      updates.password = password;
    }
    const data = await api('PATCH', '/v1/me', updates);
    if (data._error) {
      setAlert({ message: data._error, type: 'error' });
      return;
    }
    const userUpdates = {};
    if (data.name) userUpdates.name = data.name;
    if (data.email) userUpdates.email = data.email;
    updateUser(userUpdates);
    setAlert({ message: 'Profile updated.', type: 'success' });
    setPassword('');
    loadProfile();
  }

  async function handleExport() {
    const data = await api('GET', '/v1/me/export');
    if (data._error) {
      setAlert({ message: data._error, type: 'error' });
      return;
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `learn-data-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleResetSync() {
    if (!confirm('Reset all synced data? Your local extension data will not be affected.')) return;
    setResettingSync(true);
    const data = await api('DELETE', '/v1/sync');
    setResettingSync(false);
    if (data._error) {
      setAlert({ message: data._error, type: 'error' });
      return;
    }
    setLastSyncTime(null);
    setAlert({ message: `Sync data reset (${data.deleted} items removed).`, type: 'success' });
  }

  async function handleDelete() {
    if (deleteInput !== 'DELETE') return;
    setDeleting(true);
    const data = await api('DELETE', '/v1/me', { confirm: 'DELETE' });
    setDeleting(false);
    if (data._error) {
      setAlert({ message: data._error, type: 'error' });
      return;
    }
    logout();
  }

  return (
    <>
      <h2 style={{ marginBottom: 16 }}>My Profile</h2>
      <Alert
        message={alert?.message}
        type={alert?.type}
        onDismiss={() => setAlert(null)}
      />
      <div className="card">
        {loading ? (
          <div className="empty">
            <Spinner /> Loading...
          </div>
        ) : (
          <>
            <div className="form-group">
              <label htmlFor="p-name">Name</label>
              <input
                id="p-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label htmlFor="p-email">Email</label>
              <input
                id="p-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label htmlFor="p-affiliation">Affiliation</label>
              <select
                id="p-affiliation"
                value={affiliation}
                onChange={(e) => setAffiliation(e.target.value)}
              >
                <option value="">None</option>
                {affiliations.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </div>
            <hr style={{ border: 'none', borderTop: '1px solid var(--color-border)', margin: '16px 0' }} />
            <div className="form-group">
              <label htmlFor="p-password">
                New password{' '}
                <span style={{ fontWeight: 400, color: 'var(--color-text-secondary)' }}>
                  (leave blank to keep current)
                </span>
              </label>
              <PasswordInput
                id="p-password"
                placeholder="At least 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="btn-row">
              <button className="primary-btn" onClick={handleSave}>
                Save changes
              </button>
            </div>
          </>
        )}
      </div>

      {!loading && (
        <div className="card">
          <h2 style={{ fontSize: '1rem', marginBottom: 4 }}>Data Management</h2>
          <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 16 }}>
            {lastSyncTime
              ? `Last synced ${new Date(lastSyncTime).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} at ${new Date(lastSyncTime).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
              : 'No sync data'}
          </p>

          {lastSyncTime && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
              <button className="secondary-btn" onClick={handleExport}>
                Download my data
              </button>
              <button
                className="secondary-btn"
                onClick={handleResetSync}
                disabled={resettingSync}
              >
                {resettingSync ? <><span className="spinner" /> Resetting...</> : 'Reset Learn Extension Data'}
              </button>
            </div>
          )}

          <hr style={{ border: 'none', borderTop: '1px solid var(--color-border)', margin: '16px 0' }} />

          <h3 style={{ fontSize: '0.9rem', marginBottom: 8, color: 'var(--color-danger)' }}>Delete account</h3>
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 12 }}>
            Permanently delete your account and all associated data. This action is irreversible.
          </p>
          {!showDeleteConfirm ? (
            <button className="danger-btn" onClick={() => setShowDeleteConfirm(true)}>
              Delete my account
            </button>
          ) : (
            <div>
              <div className="form-group" style={{ marginBottom: 12 }}>
                <label htmlFor="delete-confirm" style={{ color: 'var(--color-danger)' }}>
                  Type DELETE to confirm
                </label>
                <input
                  id="delete-confirm"
                  value={deleteInput}
                  onChange={(e) => setDeleteInput(e.target.value)}
                  placeholder="DELETE"
                  autoFocus
                  onKeyDown={(e) => e.key === 'Escape' && (setShowDeleteConfirm(false), setDeleteInput(''))}
                />
              </div>
              <div className="btn-row">
                <button
                  className="danger-btn"
                  disabled={deleteInput !== 'DELETE' || deleting}
                  onClick={handleDelete}
                >
                  {deleting ? <><span className="spinner spinner-light" /> Deleting...</> : 'Permanently delete'}
                </button>
                <button className="secondary-btn" onClick={() => { setShowDeleteConfirm(false); setDeleteInput(''); }}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
