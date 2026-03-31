import { useState, useEffect } from 'react';
import { api } from '../../api';
import Alert from '../../components/Alert';
import Spinner from '../../components/Spinner';
export default function Settings() {
  const [affiliations, setAffiliations] = useState([]);
  const [newAffName, setNewAffName] = useState('');
  const [affAlert, setAffAlert] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dataAlert, setDataAlert] = useState(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetInput, setResetInput] = useState('');
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    document.title = 'Settings - Learn Service';
    loadSettings();
  }, []);

  async function loadSettings() {
    setLoading(true);
    const data = await api('GET', '/v1/admin/settings');
    if (data._error) {
      setAffAlert({ message: data._error, type: 'error' });
      setLoading(false);
      return;
    }
    setAffiliations(data.affiliations || []);
    setLoading(false);
  }

  async function addAffiliation() {
    const name = newAffName.trim();
    if (!name) {
      setAffAlert({ message: 'Enter an affiliation name.', type: 'error' });
      return;
    }
    const data = await api('PUT', '/v1/admin/affiliations', { name });
    if (data._error) {
      setAffAlert({ message: data._error, type: 'error' });
      return;
    }
    setAffAlert({ message: 'Affiliation added.', type: 'success' });
    setNewAffName('');
    loadSettings();
  }

  async function editAffiliation(oldName) {
    const newName = window.prompt('Rename "' + oldName + '" to:', oldName);
    if (!newName || newName.trim() === oldName) return;
    const data = await api('PUT', '/v1/admin/affiliations', {
      name: newName.trim(),
      oldName,
    });
    if (data._error) {
      setAffAlert({ message: data._error, type: 'error' });
      return;
    }
    setAffAlert({ message: 'Affiliation renamed. All participants updated.', type: 'success' });
    loadSettings();
  }

  async function resetAllSyncData() {
    if (resetInput !== 'RESET') return;
    setResetting(true);
    const data = await api('DELETE', '/v1/admin/sync');
    setResetting(false);
    if (data._error) {
      setDataAlert({ message: data._error, type: 'error' });
      return;
    }
    setDataAlert({
      message: `Sync data reset: ${data.itemsDeleted} items deleted across ${data.usersAffected} users.`,
      type: 'success',
    });
    setShowResetConfirm(false);
    setResetInput('');
  }

  async function deleteAffiliation(name) {
    if (!window.confirm('Delete "' + name + '"? This will clear the affiliation from all participants who have it.')) {
      return;
    }
    const data = await api('DELETE', '/v1/admin/affiliations/' + encodeURIComponent(name));
    if (data._error) {
      setAffAlert({ message: data._error, type: 'error' });
      return;
    }
    setAffAlert({ message: 'Affiliation deleted.', type: 'success' });
    loadSettings();
  }

  if (loading) {
    return (
      <div className="empty">
        <Spinner /> Loading...
      </div>
    );
  }

  return (
    <div aria-live="polite">
      {/* Affiliations card */}
      <div className="card">
        <h2>Affiliations</h2>
        <Alert
          message={affAlert?.message}
          type={affAlert?.type}
          onDismiss={() => setAffAlert(null)}
        />
        <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 10 }}>
          Manage the list of affiliations available to participants.
        </p>
        <div className="inline-form" style={{ marginBottom: 12 }}>
          <div className="form-group">
            <label htmlFor="aff-name">Add affiliation</label>
            <input
              id="aff-name"
              type="text"
              placeholder="Organization name"
              value={newAffName}
              onChange={(e) => setNewAffName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addAffiliation();
              }}
            />
          </div>
          <button className="primary-btn" onClick={addAffiliation}>
            Add
          </button>
        </div>
        <div
          style={{
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius)',
            overflow: 'hidden',
          }}
        >
          {affiliations.length > 0 ? (
            <table aria-label="Affiliations">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {affiliations.map((a) => (
                  <tr key={a}>
                    <td>{a}</td>
                    <td>
                      <div className="actions-cell">
                        <button
                          className="icon-btn"
                          title="Edit"
                          aria-label={`Edit ${a}`}
                          onClick={() => editAffiliation(a)}
                        >
                          &#9998;
                        </button>
                        <button
                          className="icon-btn"
                          title="Delete"
                          aria-label={`Delete ${a}`}
                          onClick={() => deleteAffiliation(a)}
                        >
                          &#10005;
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty" style={{ padding: 16 }}>
              No affiliations yet.
            </div>
          )}
        </div>
      </div>

      {/* Data Management card */}
      <div className="card">
        <h2>Data Management</h2>
        <Alert
          message={dataAlert?.message}
          type={dataAlert?.type}
          onDismiss={() => setDataAlert(null)}
        />
        <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 16 }}>
          Reset synced extension data for all participants. Local extension data on each device is not affected.
        </p>
        {!showResetConfirm ? (
          <button className="danger-btn" onClick={() => setShowResetConfirm(true)}>
            Reset all sync data
          </button>
        ) : (
          <div>
            <div className="form-group" style={{ marginBottom: 12 }}>
              <label htmlFor="reset-confirm" style={{ color: 'var(--color-danger)' }}>
                Type RESET to confirm
              </label>
              <input
                id="reset-confirm"
                value={resetInput}
                onChange={(e) => setResetInput(e.target.value)}
                placeholder="RESET"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && resetInput === 'RESET') resetAllSyncData();
                  if (e.key === 'Escape') { setShowResetConfirm(false); setResetInput(''); }
                }}
              />
            </div>
            <div className="btn-row">
              <button
                className="danger-btn"
                disabled={resetInput !== 'RESET' || resetting}
                onClick={resetAllSyncData}
              >
                {resetting ? <><span className="spinner spinner-light" /> Resetting...</> : 'Reset all sync data'}
              </button>
              <button className="secondary-btn" onClick={() => { setShowResetConfirm(false); setResetInput(''); }}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
