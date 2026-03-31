import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { adminApi } from './adminApi.js';

function parseCsvEmails(text) {
  const lines = text.split(/\r?\n/);
  const emails = [];
  const headerLine = lines[0] || '';
  const headers = headerLine.split(',').map(h => h.trim().toLowerCase().replace(/^["']|["']$/g, ''));
  const emailCol = headers.indexOf('email');
  for (let i = emailCol >= 0 ? 1 : 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    let value;
    if (emailCol >= 0) {
      const cols = line.split(',');
      value = (cols[emailCol] || '').trim().replace(/^["']|["']$/g, '');
    } else {
      value = line.replace(/^["']|["']$/g, '').trim();
    }
    if (value) emails.push(value.toLowerCase());
  }
  return emails;
}

export default function AdminParticipants() {
  const { user: currentUser } = useAuth();
  const [participants, setParticipants] = useState([]);
  const [pendingInvites, setPendingInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState('');
  const [message, setMessage] = useState(null);
  const [csvEmails, setCsvEmails] = useState(null);
  const [csvInvalid, setCsvInvalid] = useState([]);
  const [csvPreview, setCsvPreview] = useState(false);
  const csvRef = useRef(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [p, i] = await Promise.all([
        adminApi('GET', '/v1/admin/participants'),
        adminApi('GET', '/v1/admin/invites'),
      ]);
      setParticipants(Array.isArray(p) ? p : []);
      setPendingInvites(Array.isArray(i) ? i.filter(x => x.status === 'pending') : []);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    document.title = 'Participants — Admin';
    loadData();
  }, [loadData]);

  async function sendInvite() {
    const email = inviteEmail.trim();
    if (!email) { setMessage({ text: 'Email is required.', type: 'error' }); return; }
    try {
      const data = await adminApi('POST', '/v1/admin/invites', { email });
      setMessage({ text: `Invite sent to ${email}.${data.signupUrl ? ` Link: ${data.signupUrl}` : ''}`, type: 'success' });
      setInviteEmail('');
      loadData();
    } catch (e) {
      setMessage({ text: e.message, type: 'error' });
    }
  }

  async function resendInvite(email) {
    try {
      await adminApi('POST', '/v1/admin/invites/resend', { email });
      setMessage({ text: `Invite resent to ${email}.`, type: 'success' });
      loadData();
    } catch (e) { setMessage({ text: e.message, type: 'error' }); }
  }

  async function revokeInvite(token) {
    try {
      await adminApi('DELETE', `/v1/admin/invites/${token}`);
      loadData();
    } catch { /* ignore */ }
  }

  async function deleteUser(userId, name) {
    if (!confirm(`Delete ${name} and all their data? This cannot be undone.`)) return;
    try {
      await adminApi('DELETE', `/v1/admin/participants/${userId}`);
      loadData();
    } catch (e) { setMessage({ text: e.message, type: 'error' }); }
  }

  function handleCsvFile(e) {
    const file = e.target.files[0];
    if (!file) { setCsvPreview(false); setCsvEmails(null); return; }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const emails = parseCsvEmails(ev.target.result);
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      setCsvEmails(emails.filter(em => emailRegex.test(em)));
      setCsvInvalid(emails.filter(em => !emailRegex.test(em)));
      setCsvPreview(true);
    };
    reader.readAsText(file);
  }

  async function sendBulkInvites() {
    if (!csvEmails?.length) return;
    try {
      const data = await adminApi('POST', '/v1/admin/invites/bulk', { emails: csvEmails });
      setMessage({ text: `${data.sent} invite(s) sent. ${data.skipped} skipped.`, type: 'success' });
      setCsvPreview(false); setCsvEmails(null);
      if (csvRef.current) csvRef.current.value = '';
      loadData();
    } catch (e) { setMessage({ text: e.message, type: 'error' }); }
  }

  if (loading) return <div className="admin-loading">Loading...</div>;

  return (
    <div>
      <h1>Participants</h1>

      {message && (
        <div className={`admin-alert admin-alert-${message.type}`} role="alert">
          {message.text}
          <button onClick={() => setMessage(null)} aria-label="Dismiss">&times;</button>
        </div>
      )}

      <div className="admin-card">
        <div className="admin-inline-form">
          <label htmlFor="inv-email">Invite a participant</label>
          <div className="admin-input-row">
            <input id="inv-email" type="email" placeholder="participant@example.com"
              value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') sendInvite(); }} />
            <button className="primary-btn" onClick={sendInvite}>Send invite</button>
          </div>
        </div>

        <div className="admin-bulk-section">
          <label htmlFor="csv-file">Bulk invite from CSV</label>
          <input id="csv-file" type="file" accept=".csv,text/csv" ref={csvRef} onChange={handleCsvFile} />
          {csvPreview && csvEmails?.length > 0 && (
            <div className="admin-csv-preview">
              <div>{csvEmails.length} email(s) ready to invite</div>
              {csvInvalid.length > 0 && <div className="admin-csv-invalid">{csvInvalid.length} invalid: {csvInvalid.join(', ')}</div>}
              <button className="primary-btn" onClick={sendBulkInvites}>Send {csvEmails.length} invite(s)</button>
            </div>
          )}
        </div>
      </div>

      {(pendingInvites.length > 0 || participants.length > 0) && (
        <div className="admin-card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="admin-table" aria-label="Participants and invites">
            <thead><tr><th>Name</th><th>Email</th><th>Status</th><th>Date</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {pendingInvites.map(inv => (
                <tr key={inv.inviteToken}>
                  <td>&mdash;</td><td>{inv.email}</td>
                  <td><span className="admin-badge pending">Invited</span></td>
                  <td>{new Date(inv.createdAt).toLocaleDateString()}</td>
                  <td>
                    <button className="admin-icon-btn" title="Resend" onClick={() => resendInvite(inv.email)}>&#8635;</button>
                    <button className="admin-icon-btn" title="Revoke" onClick={() => revokeInvite(inv.inviteToken)}>&#10005;</button>
                  </td>
                </tr>
              ))}
              {participants.map(p => (
                <tr key={p.userId}>
                  <td>{p.name}</td><td>{p.email}</td>
                  <td><span className={`admin-badge ${p.role}`}>{p.role === 'admin' ? 'Admin' : 'Participant'}</span></td>
                  <td>{new Date(p.createdAt).toLocaleDateString()}</td>
                  <td>
                    {p.userId !== currentUser?.userId && (
                      <button className="admin-icon-btn" title="Delete" onClick={() => deleteUser(p.userId, p.name || p.email)}>&#128465;</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
