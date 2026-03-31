import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth';
import { api, API } from '../../api';
import Alert from '../../components/Alert';
import Spinner from '../../components/Spinner';

function parseCsvEmails(text) {
  const lines = text.split(/\r?\n/);
  const emails = [];
  const headerLine = lines[0] || '';
  const headers = headerLine.split(',').map((h) =>
    h.trim().toLowerCase().replace(/^["']|["']$/g, '')
  );
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

export default function Participants() {
  const { auth } = useAuth();
  const navigate = useNavigate();
  const [participants, setParticipants] = useState([]);
  const [pendingInvites, setPendingInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState('');
  const [alert, setAlert] = useState(null);
  const [csvEmails, setCsvEmails] = useState(null);
  const [csvInvalid, setCsvInvalid] = useState([]);
  const [csvPreviewVisible, setCsvPreviewVisible] = useState(false);
  const csvFileRef = useRef(null);

  useEffect(() => {
    document.title = 'Participants - Learn Service';
    loadData();
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [pData, iData] = await Promise.all([
      api('GET', '/v1/admin/participants'),
      api('GET', '/v1/admin/invites'),
    ]);
    if (!pData._error) setParticipants(pData);
    if (!iData._error) {
      setPendingInvites(iData.filter((i) => i.status === 'pending'));
    }
    setLoading(false);
  }, []);

  async function sendInvite() {
    const email = inviteEmail.trim();
    if (!email) {
      setAlert({ message: 'Email is required.', type: 'error' });
      return;
    }
    const data = await api('POST', '/v1/admin/invites', { email });
    if (data._error) {
      setAlert({ message: data._error, type: 'error' });
      return;
    }
    const link = data.signupUrl || '';
    const msg = 'Invite sent to ' + email + '.'
      + (link
        ? ' <span style="display:block;margin-top:6px;font-size:12px;word-break:break-all">Signup link: <a href="' + link + '" style="color:var(--color-success)">' + link + '</a></span>'
        : '');
    setAlert({ message: msg, type: 'success', raw: true, persist: true });
    setInviteEmail('');
    loadData();
  }

  function copySignupLink(token) {
    const url = location.origin + '?token=' + token;
    navigator.clipboard.writeText(url).then(() => {
      setAlert({ message: 'Signup link copied to clipboard.', type: 'success' });
    });
  }

  async function revokeInvite(token) {
    await api('DELETE', '/v1/admin/invites/' + token);
    loadData();
  }

  async function resendInvite(email) {
    const data = await api('POST', '/v1/admin/invites/resend', { email });
    if (data._error) {
      setAlert({ message: data._error, type: 'error' });
      return;
    }
    const link = data.signupUrl || '';
    const msg = 'Invite resent to ' + email + '.'
      + (link
        ? ' <span style="display:block;margin-top:6px;font-size:12px;word-break:break-all">Signup link: <a href="' + link + '" style="color:var(--color-success)">' + link + '</a></span>'
        : '');
    setAlert({ message: msg, type: 'success', raw: true, persist: true });
    loadData();
  }

  function confirmDeleteUser(userId, name) {
    if (window.confirm('Delete ' + name + ' and all their data? This cannot be undone.')) {
      deleteUser(userId);
    }
  }

  async function deleteUser(userId) {
    const data = await api('DELETE', '/v1/admin/participants/' + userId);
    if (data._error) {
      setAlert({ message: data._error, type: 'error' });
      return;
    }
    loadData();
  }

  function handleCsvFile(e) {
    const file = e.target.files[0];
    if (!file) {
      setCsvPreviewVisible(false);
      setCsvEmails(null);
      setCsvInvalid([]);
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const emails = parseCsvEmails(ev.target.result);
      if (emails.length === 0) {
        setCsvPreviewVisible(true);
        setCsvEmails(null);
        setCsvInvalid([]);
        setAlert({
          message: 'No valid emails found. CSV should have an "email" column or one email per line.',
          type: 'error',
        });
        return;
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const valid = emails.filter((em) => emailRegex.test(em));
      const invalid = emails.filter((em) => !emailRegex.test(em));
      setCsvEmails(valid.length > 0 ? valid : null);
      setCsvInvalid(invalid);
      setCsvPreviewVisible(true);
    };
    reader.readAsText(file);
  }

  async function sendBulkInvites() {
    if (!csvEmails || csvEmails.length === 0) return;
    setAlert({
      message: 'Sending ' + csvEmails.length + ' invite' + (csvEmails.length !== 1 ? 's' : '') + '...',
      type: 'success',
    });
    setCsvPreviewVisible(false);
    const data = await api('POST', '/v1/admin/invites/bulk', { emails: csvEmails });
    if (data._error) {
      setAlert({ message: data._error, type: 'error' });
      return;
    }
    let msg = data.sent + ' invite' + (data.sent !== 1 ? 's' : '') + ' sent.';
    if (data.skipped > 0) {
      const reasons = data.results.filter((r) => r.status !== 'sent');
      msg += ' ' + data.skipped + ' skipped';
      if (reasons.length > 0) {
        msg += ': ' + reasons.map((r) => r.email + ' (' + r.reason + ')').join(', ');
      }
      msg += '.';
    }
    setAlert({
      message: msg,
      type: data.sent > 0 ? 'success' : 'error',
      raw: true,
      persist: true,
    });
    if (csvFileRef.current) csvFileRef.current.value = '';
    setCsvEmails(null);
    setCsvInvalid([]);
    setCsvPreviewVisible(false);
    loadData();
  }

  if (loading) {
    return (
      <div className="empty">
        <Spinner /> Loading...
      </div>
    );
  }

  const hasRows = pendingInvites.length > 0 || participants.length > 0;

  return (
    <div aria-live="polite">
      {/* Invite form */}
      <div className="card">
        <Alert
          message={alert?.message}
          type={alert?.type}
          raw={alert?.raw}
          onDismiss={() => setAlert(null)}
        />
        <div className="inline-form">
          <div className="form-group">
            <label htmlFor="inv-email">Invite a participant</label>
            <input
              id="inv-email"
              type="email"
              placeholder="participant@example.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') sendInvite();
              }}
            />
          </div>
          <button className="primary-btn" onClick={sendInvite}>
            Send invite
          </button>
        </div>

        {/* Bulk CSV section */}
        <div className="bulk-section" role="group" aria-labelledby="bulk-invite-label">
          <div className="bulk-header">
            <label id="bulk-invite-label" htmlFor="csv-file">
              Bulk invite from CSV
            </label>
            <a
              href={API + '/v1/invite-example.csv'}
              download
              className="secondary-btn"
            >
              Download example CSV
            </a>
          </div>
          <div className="file-input-wrap">
            <input
              id="csv-file"
              type="file"
              accept=".csv,text/csv"
              aria-describedby="csv-help"
              ref={csvFileRef}
              onChange={handleCsvFile}
            />
          </div>
          <p id="csv-help" className="sr-only">
            Upload a CSV file with an email column. One email per row.
          </p>
          <div aria-live="polite">
            {csvPreviewVisible && (
              <div style={{ marginTop: 12, fontSize: 13 }}>
                {csvInvalid.length > 0 && (
                  <div className="alert alert-error" role="alert">
                    {csvInvalid.length} invalid email{csvInvalid.length !== 1 ? 's' : ''}:{' '}
                    {csvInvalid.join(', ')}
                  </div>
                )}
                {csvEmails && csvEmails.length > 0 && (
                  <>
                    <div className="csv-preview-box">
                      <div className="csv-count">
                        {csvEmails.length} email{csvEmails.length !== 1 ? 's' : ''} ready to invite
                      </div>
                      <div className="csv-email-list" role="list">
                        {csvEmails.map((em) => (
                          <div key={em} role="listitem">{em}</div>
                        ))}
                      </div>
                    </div>
                    <button
                      className="primary-btn"
                      onClick={sendBulkInvites}
                      aria-label={`Send ${csvEmails.length} bulk invite${csvEmails.length !== 1 ? 's' : ''}`}
                    >
                      Send {csvEmails.length} invite{csvEmails.length !== 1 ? 's' : ''}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Table */}
      {hasRows ? (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table aria-label="Participants and invites">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Affiliation</th>
                <th>Status</th>
                <th>Date</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {/* Pending invites */}
              {pendingInvites.map((inv) => (
                <tr key={inv.inviteToken}>
                  <td style={{ color: 'var(--color-text-secondary)' }}>&mdash;</td>
                  <td>{inv.email}</td>
                  <td>&mdash;</td>
                  <td>
                    <span className="badge badge-pending">Invited</span>
                  </td>
                  <td>{new Date(inv.createdAt).toLocaleDateString()}</td>
                  <td>
                    <div className="actions-cell">
                      <button
                        className="icon-btn"
                        title="Resend invite"
                        aria-label={`Resend invite to ${inv.email}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          resendInvite(inv.email);
                        }}
                      >
                        &#8635;
                      </button>
                      <button
                        className="icon-btn"
                        title="Copy signup link"
                        aria-label={`Copy signup link for ${inv.email}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          copySignupLink(inv.inviteToken);
                        }}
                      >
                        &#128279;
                      </button>
                      <button
                        className="icon-btn"
                        title="Revoke invite"
                        aria-label={`Revoke invite for ${inv.email}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          revokeInvite(inv.inviteToken);
                        }}
                      >
                        &#10005;
                      </button>
                    </div>
                  </td>
                </tr>
              ))}

              {/* Participants */}
              {participants.map((p) => {
                const roleClass = p.role === 'admin' ? 'badge-used' : 'badge-active';
                const roleLabel = p.role === 'admin' ? 'Admin' : 'Participant';
                const isSelf = p.userId === auth?.user?.userId;
                return (
                  <tr
                    key={p.userId}
                    tabIndex={0}
                    role="button"
                    aria-label={`View ${p.name || p.email}`}
                    onClick={() => navigate('/participants/' + p.userId)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') navigate('/participants/' + p.userId);
                    }}
                  >
                    <td>{p.name}</td>
                    <td>{p.email}</td>
                    <td>{p.affiliation || '\u2014'}</td>
                    <td>
                      <span className={`badge ${roleClass}`}>{roleLabel}</span>
                    </td>
                    <td>{new Date(p.createdAt).toLocaleDateString()}</td>
                    <td>
                      {!isSelf && (
                        <div className="actions-cell">
                          <button
                            className="icon-btn"
                            title="Delete user"
                            aria-label={`Delete ${p.name || p.email}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              confirmDeleteUser(p.userId, p.name || p.email);
                            }}
                          >
                            &#128465;
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty">No participants yet. Send an invite to get started.</div>
      )}
    </div>
  );
}
