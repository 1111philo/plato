import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { adminApi } from './adminApi.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';

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

  if (loading) return <div className="flex items-center justify-center py-12 text-muted-foreground">Loading...</div>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Participants</h1>

      {message && (
        <div
          className={`flex items-center justify-between rounded-lg px-4 py-3 mb-4 text-sm ${
            message.type === 'error'
              ? 'bg-destructive/10 text-destructive'
              : 'bg-green-50 text-green-800 dark:bg-green-900/20 dark:text-green-400'
          }`}
          role="alert"
        >
          <span>{message.text}</span>
          <button
            onClick={() => setMessage(null)}
            aria-label="Dismiss"
            className="ml-2 text-lg leading-none hover:opacity-70"
          >
            &times;
          </button>
        </div>
      )}

      <Card className="mb-6">
        <CardContent className="space-y-6">
          {/* Single invite */}
          <div className="space-y-2">
            <Label htmlFor="inv-email">Invite a participant</Label>
            <div className="flex gap-2">
              <Input
                id="inv-email"
                type="email"
                placeholder="participant@example.com"
                value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') sendInvite(); }}
                className="flex-1"
              />
              <Button onClick={sendInvite}>Send invite</Button>
            </div>
          </div>

          {/* Bulk invite */}
          <div className="space-y-2">
            <Label htmlFor="csv-file">Bulk invite from CSV</Label>
            <Input id="csv-file" type="file" accept=".csv,text/csv" ref={csvRef} onChange={handleCsvFile} />
            {csvPreview && csvEmails?.length > 0 && (
              <div className="space-y-2 pt-2">
                <div className="text-sm">{csvEmails.length} email(s) ready to invite</div>
                {csvInvalid.length > 0 && (
                  <div className="text-sm text-destructive">{csvInvalid.length} invalid: {csvInvalid.join(', ')}</div>
                )}
                <Button onClick={sendBulkInvites}>Send {csvEmails.length} invite(s)</Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {(pendingInvites.length > 0 || participants.length > 0) && (
        <Card className="p-0 overflow-hidden">
          <Table aria-label="Participants and invites">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Date</TableHead>
                <TableHead><span className="sr-only">Actions</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pendingInvites.map(inv => (
                <TableRow key={inv.inviteToken}>
                  <TableCell>&mdash;</TableCell>
                  <TableCell>{inv.email}</TableCell>
                  <TableCell><Badge variant="outline">Invited</Badge></TableCell>
                  <TableCell>{new Date(inv.createdAt).toLocaleDateString()}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon-xs" title="Resend" onClick={() => resendInvite(inv.email)}>
                        &#8635;
                      </Button>
                      <Button variant="ghost" size="icon-xs" title="Revoke" onClick={() => revokeInvite(inv.inviteToken)}>
                        &#10005;
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {participants.map(p => (
                <TableRow key={p.userId}>
                  <TableCell>{p.name}</TableCell>
                  <TableCell>{p.email}</TableCell>
                  <TableCell>
                    <Badge variant={p.role === 'admin' ? 'default' : 'secondary'}>
                      {p.role === 'admin' ? 'Admin' : 'Participant'}
                    </Badge>
                  </TableCell>
                  <TableCell>{new Date(p.createdAt).toLocaleDateString()}</TableCell>
                  <TableCell>
                    {p.userId !== currentUser?.userId && (
                      <Button variant="ghost" size="icon-xs" title="Delete" onClick={() => deleteUser(p.userId, p.name || p.email)}>
                        &#128465;
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
