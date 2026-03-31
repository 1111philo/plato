import { useState, useEffect } from 'react';
import { adminApi } from './adminApi.js';

export default function AdminPrompts() {
  const [prompts, setPrompts] = useState([]);
  const [editing, setEditing] = useState(null); // { name, content }
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.title = 'Prompts — Admin';
    loadPrompts();
  }, []);

  async function loadPrompts() {
    setLoading(true);
    try {
      const data = await adminApi('GET', '/v1/admin/prompts');
      setPrompts(Array.isArray(data) ? data : []);
    } catch { /* ignore */ }
    setLoading(false);
  }

  async function editPrompt(name) {
    try {
      const data = await adminApi('GET', `/v1/admin/prompts/${encodeURIComponent(name)}`);
      setEditing({ name, content: data.content || '' });
    } catch (e) { setMessage({ text: e.message, type: 'error' }); }
  }

  async function savePrompt() {
    if (!editing) return;
    try {
      await adminApi('PUT', `/v1/admin/prompts/${encodeURIComponent(editing.name)}`, {
        content: editing.content,
      });
      setMessage({ text: `Prompt "${editing.name}" saved.`, type: 'success' });
      setEditing(null);
      loadPrompts();
    } catch (e) { setMessage({ text: e.message, type: 'error' }); }
  }

  if (loading) return <div className="admin-loading">Loading...</div>;

  if (editing) {
    return (
      <div>
        <h1>Edit: {editing.name}</h1>
        <div className="admin-card">
          <div className="form-group">
            <label htmlFor="prompt-content">System Prompt</label>
            <textarea id="prompt-content" className="admin-code-editor" rows={25}
              value={editing.content}
              onChange={e => setEditing({ ...editing, content: e.target.value })} />
          </div>
          <div className="admin-btn-row">
            <button className="primary-btn" onClick={savePrompt}>Save</button>
            <button className="secondary-btn" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1>System Prompts</h1>
      {message && (
        <div className={`admin-alert admin-alert-${message.type}`} role="alert">
          {message.text}
          <button onClick={() => setMessage(null)} aria-label="Dismiss">&times;</button>
        </div>
      )}
      <p className="admin-subtitle">These prompts drive the AI agents. Changes take effect immediately.</p>
      <div className="admin-card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="admin-table" aria-label="System prompts">
          <thead><tr><th>Name</th><th>Updated</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {prompts.map(p => (
              <tr key={p.name}>
                <td><code>{p.name}</code></td>
                <td>{p.updatedAt ? new Date(p.updatedAt).toLocaleDateString() : '—'}</td>
                <td>
                  <button className="admin-icon-btn" title="Edit" onClick={() => editPrompt(p.name)}>&#9998;</button>
                </td>
              </tr>
            ))}
            {prompts.length === 0 && <tr><td colSpan={3} style={{ textAlign: 'center', padding: 24 }}>No prompts seeded yet. Run the seed script.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
