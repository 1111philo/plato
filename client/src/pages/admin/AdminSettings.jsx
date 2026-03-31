import { useState, useEffect } from 'react';
import { adminApi } from './adminApi.js';

export default function AdminSettings() {
  const [affiliations, setAffiliations] = useState([]);
  const [newAffName, setNewAffName] = useState('');
  const [knowledgeBase, setKnowledgeBase] = useState('');
  const [kbEditing, setKbEditing] = useState(false);
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetInput, setResetInput] = useState('');

  useEffect(() => {
    document.title = 'Settings — Admin';
    loadSettings();
  }, []);

  async function loadSettings() {
    setLoading(true);
    try {
      const [settings, kb] = await Promise.all([
        adminApi('GET', '/v1/admin/settings'),
        adminApi('GET', '/v1/admin/knowledge-base'),
      ]);
      setAffiliations(settings.affiliations || []);
      setKnowledgeBase(kb.content || '');
    } catch { /* ignore */ }
    setLoading(false);
  }

  async function addAffiliation() {
    const name = newAffName.trim();
    if (!name) return;
    try {
      const data = await adminApi('PUT', '/v1/admin/affiliations', { name });
      setAffiliations(data.affiliations || []);
      setNewAffName('');
      setMessage({ text: 'Affiliation added.', type: 'success' });
    } catch (e) { setMessage({ text: e.message, type: 'error' }); }
  }

  async function deleteAffiliation(name) {
    if (!confirm(`Delete "${name}"? This will clear the affiliation from all participants.`)) return;
    try {
      const data = await adminApi('DELETE', `/v1/admin/affiliations/${encodeURIComponent(name)}`);
      setAffiliations(data.affiliations || []);
      setMessage({ text: 'Affiliation deleted.', type: 'success' });
    } catch (e) { setMessage({ text: e.message, type: 'error' }); }
  }

  async function saveKnowledgeBase() {
    try {
      await adminApi('PUT', '/v1/admin/knowledge-base', { content: knowledgeBase });
      setMessage({ text: 'Knowledge base saved.', type: 'success' });
      setKbEditing(false);
    } catch (e) { setMessage({ text: e.message, type: 'error' }); }
  }

  async function resetAllSyncData() {
    if (resetInput !== 'RESET') return;
    try {
      const data = await adminApi('DELETE', '/v1/admin/sync');
      setMessage({ text: `Sync data reset: ${data.itemsDeleted} items deleted across ${data.usersAffected} users.`, type: 'success' });
      setShowResetConfirm(false);
      setResetInput('');
    } catch (e) { setMessage({ text: e.message, type: 'error' }); }
  }

  if (loading) return <div className="admin-loading">Loading...</div>;

  return (
    <div>
      <h1>Settings</h1>
      {message && (
        <div className={`admin-alert admin-alert-${message.type}`} role="alert">
          {message.text}
          <button onClick={() => setMessage(null)} aria-label="Dismiss">&times;</button>
        </div>
      )}

      <div className="admin-card">
        <h2>Affiliations</h2>
        <div className="admin-inline-form">
          <div className="admin-input-row">
            <input type="text" placeholder="Organization name" value={newAffName}
              onChange={e => setNewAffName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addAffiliation(); }} />
            <button className="primary-btn" onClick={addAffiliation}>Add</button>
          </div>
        </div>
        {affiliations.length > 0 ? (
          <ul className="admin-aff-list">
            {affiliations.map(a => (
              <li key={a}>
                <span>{a}</span>
                <button className="admin-icon-btn" title="Delete" onClick={() => deleteAffiliation(a)}>&#10005;</button>
              </li>
            ))}
          </ul>
        ) : <p className="admin-subtitle">No affiliations yet.</p>}
      </div>

      <div className="admin-card">
        <h2>Knowledge Base</h2>
        <p className="admin-subtitle">Injected into the coach system prompt so it can answer program questions.</p>
        {kbEditing ? (
          <>
            <textarea className="admin-code-editor" rows={15} value={knowledgeBase}
              onChange={e => setKnowledgeBase(e.target.value)} />
            <div className="admin-btn-row">
              <button className="primary-btn" onClick={saveKnowledgeBase}>Save</button>
              <button className="secondary-btn" onClick={() => setKbEditing(false)}>Cancel</button>
            </div>
          </>
        ) : (
          <>
            <pre className="admin-kb-preview">{knowledgeBase.slice(0, 500)}{knowledgeBase.length > 500 ? '...' : ''}</pre>
            <button className="secondary-btn" onClick={() => setKbEditing(true)}>Edit Knowledge Base</button>
          </>
        )}
      </div>

      <div className="admin-card">
        <h2>Danger Zone</h2>
        <p className="admin-subtitle">Reset synced data for all participants. This cannot be undone.</p>
        {!showResetConfirm ? (
          <button className="danger-btn" onClick={() => setShowResetConfirm(true)}>Reset all sync data</button>
        ) : (
          <div>
            <label htmlFor="reset-confirm" style={{ color: 'var(--color-warning)' }}>Type RESET to confirm</label>
            <div className="admin-input-row" style={{ marginTop: 8 }}>
              <input id="reset-confirm" value={resetInput} onChange={e => setResetInput(e.target.value)}
                placeholder="RESET" onKeyDown={e => {
                  if (e.key === 'Enter' && resetInput === 'RESET') resetAllSyncData();
                  if (e.key === 'Escape') { setShowResetConfirm(false); setResetInput(''); }
                }} />
              <button className="danger-btn" disabled={resetInput !== 'RESET'} onClick={resetAllSyncData}>Reset</button>
              <button className="secondary-btn" onClick={() => { setShowResetConfirm(false); setResetInput(''); }}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
