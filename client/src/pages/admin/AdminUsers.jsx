import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { adminApi } from './adminApi.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';

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

export default function AdminUsers() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [pendingInvites, setPendingInvites] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);

  // Modal states
  const [inviteOpen, setInviteOpen] = useState(false);
  const [groupsOpen, setGroupsOpen] = useState(false);

  // Invite form
  const [inviteEmail, setInviteEmail] = useState('');
  const [csvEmails, setCsvEmails] = useState(null);
  const [csvInvalid, setCsvInvalid] = useState([]);
  const [csvPreview, setCsvPreview] = useState(false);
  const csvRef = useRef(null);

  // Groups form
  const [newGroupName, setNewGroupName] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [p, i, s] = await Promise.all([
        adminApi('GET', '/v1/admin/users'),
        adminApi('GET', '/v1/admin/invites'),
        adminApi('GET', '/v1/admin/settings'),
      ]);
      setUsers(Array.isArray(p) ? p : []);
      setPendingInvites(Array.isArray(i) ? i.filter(x => x.status === 'pending') : []);
      setGroups(s.userGroups || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    document.title = 'Users — plato';
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
    } catch (e) { setMessage({ text: e.message, type: 'error' }); }
  }

  async function resendInvite(email) {
    try {
      await adminApi('POST', '/v1/admin/invites/resend', { email });
      setMessage({ text: `Invite resent to ${email}.`, type: 'success' });
      loadData();
    } catch (e) { setMessage({ text: e.message, type: 'error' }); }
  }

  async function revokeInvite(token) {
    try { await adminApi('DELETE', `/v1/admin/invites/${token}`); loadData(); } catch { /* ignore */ }
  }

  async function deleteUser(userId, name) {
    if (!confirm(`Delete ${name} and all their data? This cannot be undone.`)) return;
    try { await adminApi('DELETE', `/v1/admin/users/${userId}`); loadData(); }
    catch (e) { setMessage({ text: e.message, type: 'error' }); }
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
      setInviteOpen(false);
      loadData();
    } catch (e) { setMessage({ text: e.message, type: 'error' }); }
  }

  async function addGroup() {
    const name = newGroupName.trim();
    if (!name) return;
    try {
      const data = await adminApi('PUT', '/v1/admin/groups', { name });
      setGroups(data.userGroups || []);
      setNewGroupName('');
    } catch (e) { setMessage({ text: e.message, type: 'error' }); }
  }

  async function deleteGroup(name) {
    try {
      const data = await adminApi('DELETE', `/v1/admin/groups/${encodeURIComponent(name)}`);
      setGroups(data.userGroups || []);
    } catch (e) { setMessage({ text: e.message, type: 'error' }); }
  }

  if (loading) return <div className="flex items-center justify-center py-12 text-muted-foreground" role="status" aria-live="polite">Loading...</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Users</h1>
        <div className="flex gap-2">
          <Button onClick={() => setInviteOpen(true)}>Invite User</Button>
          <Button variant="outline" onClick={() => setGroupsOpen(true)}>User Groups</Button>
        </div>
      </div>

      {message && (
        <div className={`flex items-center justify-between rounded-lg px-4 py-3 mb-4 text-sm ${
          message.type === 'error' ? 'bg-destructive/10 text-destructive' : 'bg-green-50 text-green-800'
        }`} role="alert">
          <span>{message.text}</span>
          <button onClick={() => setMessage(null)} aria-label="Dismiss" className="ml-2 text-lg leading-none hover:opacity-70">&times;</button>
        </div>
      )}

      {(pendingInvites.length > 0 || users.length > 0) ? (
        <div className="rounded-lg border overflow-hidden">
          <Table aria-label="Users and invites">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Group</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Date</TableHead>
                <TableHead><span className="sr-only">Actions</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pendingInvites.map(inv => (
                <TableRow key={inv.inviteToken}>
                  <TableCell className="text-muted-foreground">&mdash;</TableCell>
                  <TableCell>{inv.email}</TableCell>
                  <TableCell>&mdash;</TableCell>
                  <TableCell><Badge variant="outline">Invited</Badge></TableCell>
                  <TableCell>{new Date(inv.createdAt).toLocaleDateString()}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon-xs" title="Resend" aria-label={`Resend invite to ${inv.email}`} onClick={() => resendInvite(inv.email)}>&#8635;</Button>
                      <Button variant="ghost" size="icon-xs" title="Revoke" aria-label={`Revoke invite for ${inv.email}`} onClick={() => revokeInvite(inv.inviteToken)}>&#10005;</Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {users.map(p => (
                <TableRow key={p.userId}>
                  <TableCell>{p.name}</TableCell>
                  <TableCell>{p.email}</TableCell>
                  <TableCell>{p.userGroup || <span className="text-muted-foreground">&mdash;</span>}</TableCell>
                  <TableCell>
                    <Badge variant={p.role === 'admin' ? 'default' : 'secondary'}>
                      {p.role === 'admin' ? 'Admin' : 'User'}
                    </Badge>
                  </TableCell>
                  <TableCell>{new Date(p.createdAt).toLocaleDateString()}</TableCell>
                  <TableCell>
                    {p.userId !== currentUser?.userId && (
                      <Button variant="ghost" size="icon-xs" title="Delete" aria-label={`Delete ${p.name || p.email}`} onClick={() => deleteUser(p.userId, p.name || p.email)}>&#128465;</Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <p className="text-muted-foreground py-8 text-center">No users yet. Click "Invite User" to get started.</p>
      )}

      {/* Invite User Modal */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite User</DialogTitle>
            <DialogDescription>Send an invite by email or upload a CSV for bulk invites.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="modal-inv-email">Email</Label>
              <div className="flex gap-2">
                <Input id="modal-inv-email" type="email" placeholder="user@example.com"
                  value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') sendInvite(); }} className="flex-1" />
                <Button onClick={sendInvite}>Send</Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="modal-csv">Bulk invite (CSV)</Label>
              <Input id="modal-csv" type="file" accept=".csv,text/csv" ref={csvRef} onChange={handleCsvFile} />
              {csvPreview && csvEmails?.length > 0 && (
                <div className="space-y-2 pt-1">
                  <p className="text-sm">{csvEmails.length} email(s) ready</p>
                  {csvInvalid.length > 0 && <p className="text-sm text-destructive">{csvInvalid.length} invalid</p>}
                  <Button onClick={sendBulkInvites}>Send {csvEmails.length} invite(s)</Button>
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* User Groups Modal */}
      <Dialog open={groupsOpen} onOpenChange={setGroupsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>User Groups</DialogTitle>
            <DialogDescription>Groups are available for users to select during signup.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex gap-2">
              <Label htmlFor="new-group-name" className="sr-only">Group name</Label>
              <Input id="new-group-name" type="text" placeholder="Group name" value={newGroupName}
                onChange={e => setNewGroupName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addGroup(); }} className="flex-1" />
              <Button onClick={addGroup}>Add</Button>
            </div>
            {groups.length > 0 ? (
              <ul className="space-y-1">
                {groups.map(g => (
                  <li key={g} className="flex items-center justify-between rounded-md px-3 py-2 bg-muted/50">
                    <span className="text-sm">{g}</span>
                    <Button variant="ghost" size="icon-xs" title="Delete" aria-label={`Delete group ${g}`} onClick={() => deleteGroup(g)}>&#10005;</Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No user groups yet.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
