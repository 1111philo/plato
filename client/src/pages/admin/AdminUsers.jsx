import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { adminApi } from './adminApi.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

const PAGE_SIZE = 20;

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

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  const [editUser, setEditUser] = useState(null);
  const [editForm, setEditForm] = useState({ name: '', email: '', username: '', userGroup: '', role: '' });

  // Invite modal state
  const [inviteInput, setInviteInput] = useState('');
  const [emailQueue, setEmailQueue] = useState([]);
  const [inviteSending, setInviteSending] = useState(false);
  const [inviteNotice, setInviteNotice] = useState(null);
  const csvRef = useRef(null);

  // Search, filter, pagination
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);

  // Groups form
  const [newGroupName, setNewGroupName] = useState('');

  // Slack integration state
  const [slackConnected, setSlackConnected] = useState(false);
  const [inviteTab, setInviteTab] = useState('email');
  const [slackSearch, setSlackSearch] = useState('');
  const [slackSearchResults, setSlackSearchResults] = useState([]);
  const [slackSearching, setSlackSearching] = useState(false);
  const [slackChannels, setSlackChannels] = useState([]);
  const [slackSelectedChannel, setSlackSelectedChannel] = useState('');
  const [slackQueue, setSlackQueue] = useState([]);
  const [slackSending, setSlackSending] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [usersRes, invitesRes, settingsRes, pluginsRes] = await Promise.all([
        adminApi('GET', '/v1/admin/users'),
        adminApi('GET', '/v1/admin/invites'),
        adminApi('GET', '/v1/admin/settings'),
        adminApi('GET', '/v1/admin/plugins').catch(() => []),
      ]);
      setUsers(Array.isArray(usersRes) ? usersRes : []);
      setPendingInvites(Array.isArray(invitesRes) ? invitesRes.filter(x => x.status === 'pending') : []);
      setGroups(settingsRes.userGroups || []);
      // Slack connection status comes from the plugin's settings, not legacy _system:settings.slack.
      // The Slack tab is hidden when the plugin is disabled OR not connected.
      const slack = Array.isArray(pluginsRes) ? pluginsRes.find((entry) => entry.id === 'slack') : null;
      setSlackConnected(!!(slack?.enabled && slack?.settings?.connected));
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    document.title = 'Users — plato';
    loadData();
  }, [loadData]);

  // -- Invite modal logic --

  const existingEmails = useMemo(() => {
    const set = new Set();
    for (const u of users) set.add(u.email.toLowerCase());
    for (const inv of pendingInvites) set.add(inv.email.toLowerCase());
    return set;
  }, [users, pendingInvites]);

  function addEmailsToQueue(raw) {
    const parts = raw.split(/[,\n]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
    const toAdd = [];
    let skipped = 0;

    setEmailQueue(prev => {
      const existing = new Set(prev);
      const next = [...prev];
      for (const email of parts) {
        if (!emailRegex.test(email) || existing.has(email) || existingEmails.has(email)) {
          continue;
        }
        existing.add(email);
        next.push(email);
        toAdd.push(email);
      }
      return next;
    });

    skipped = parts.length - toAdd.length;
    return { skipped, total: parts.length };
  }

  function handleAddEmails() {
    if (!inviteInput.trim()) return;
    setInviteNotice(null);
    const parts = inviteInput.split(/[,\n]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
    // Check against current queue + existing users before setState
    const skipped = parts.filter(email =>
      !emailRegex.test(email) || existingEmails.has(email) || emailQueue.includes(email)
    ).length;

    setEmailQueue(prev => {
      const existing = new Set(prev);
      const next = [...prev];
      for (const email of parts) {
        if (!emailRegex.test(email) || existing.has(email) || existingEmails.has(email)) continue;
        existing.add(email);
        next.push(email);
      }
      return next;
    });

    if (skipped > 0) {
      const msg = parts.length === 1
        ? 'This user already exists or has a pending invite.'
        : `${skipped} of ${parts.length} skipped (already exist or have pending invites).`;
      setInviteNotice(msg);
    }
    setInviteInput('');
  }

  function handleCsvFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const emails = parseCsvEmails(ev.target.result);
      addEmailsToQueue(emails.join(','));
      if (csvRef.current) csvRef.current.value = '';
    };
    reader.readAsText(file);
  }

  function removeFromQueue(email) {
    setEmailQueue(prev => prev.filter(e => e !== email));
  }

  async function sendInvites() {
    if (emailQueue.length === 0) return;
    setInviteSending(true);
    try {
      const data = await adminApi('POST', '/v1/admin/invites/bulk', { emails: emailQueue });
      const parts = [];
      if (data.sent > 0) parts.push(`${data.sent} invite(s) sent`);
      if (data.skipped > 0) parts.push(`${data.skipped} skipped`);
      setMessage({ text: parts.join('. ') + '.', type: data.sent > 0 ? 'success' : 'error' });
      setEmailQueue([]);
      setInviteOpen(false);
      loadData();
    } catch (e) {
      setMessage({ text: e.message, type: 'error' });
    } finally {
      setInviteSending(false);
    }
  }

  function handleInviteClose(open) {
    if (!open) {
      setEmailQueue([]);
      setInviteInput('');
      if (csvRef.current) csvRef.current.value = '';
      setSlackQueue([]);
      setSlackSearch('');
      setSlackSearchResults([]);
      setInviteTab('email');
      setInviteNotice(null);
    }
    setInviteOpen(open);
  }

  // -- Slack invite logic --

  const slackSearchTimeout = useRef(null);

  function handleSlackSearchChange(value) {
    setSlackSearch(value);
    clearTimeout(slackSearchTimeout.current);
    if (!value.trim()) { setSlackSearchResults([]); return; }
    slackSearchTimeout.current = setTimeout(async () => {
      setSlackSearching(true);
      try {
        const results = await adminApi('GET', `/v1/plugins/slack/admin/users?q=${encodeURIComponent(value)}`);
        setSlackSearchResults(Array.isArray(results) ? results : []);
      } catch { setSlackSearchResults([]); }
      setSlackSearching(false);
    }, 300);
  }

  async function loadSlackChannels() {
    try {
      const channels = await adminApi('GET', '/v1/plugins/slack/admin/channels');
      setSlackChannels(Array.isArray(channels) ? channels : []);
    } catch { setSlackChannels([]); }
  }

  async function loadChannelMembers(channelId) {
    if (!channelId) return;
    setSlackSearching(true);
    try {
      const members = await adminApi('GET', `/v1/plugins/slack/admin/channels/${channelId}/members`);
      // Add all members to queue at once
      if (Array.isArray(members)) {
        setSlackQueue(prev => {
          const existingIds = new Set(prev.map(u => u.slackUserId));
          const newMembers = members.filter(m => !existingIds.has(m.slackUserId) && m.email && !existingEmails.has(m.email.toLowerCase()));
          return [...prev, ...newMembers];
        });
      }
    } catch { /* ignore */ }
    setSlackSearching(false);
    setSlackSelectedChannel('');
  }

  function addToSlackQueue(user) {
    setInviteNotice(null);
    setSlackQueue(prev => {
      if (prev.some(u => u.slackUserId === user.slackUserId)) {
        setInviteNotice(`${user.name} is already in the queue.`);
        return prev;
      }
      if (user.email && existingEmails.has(user.email.toLowerCase())) {
        setInviteNotice(`${user.name} already exists or has a pending invite.`);
        return prev;
      }
      return [...prev, user];
    });
    setSlackSearch('');
    setSlackSearchResults([]);
  }

  function removeFromSlackQueue(slackUserId) {
    setSlackQueue(prev => prev.filter(u => u.slackUserId !== slackUserId));
  }

  async function sendSlackInvites() {
    if (slackQueue.length === 0) return;
    setSlackSending(true);
    try {
      const data = await adminApi('POST', '/v1/plugins/slack/admin/invites', { users: slackQueue });
      const parts = [];
      if (data.sent > 0) parts.push(`${data.sent} Slack invite(s) sent`);
      if (data.skipped > 0) parts.push(`${data.skipped} skipped`);
      setMessage({ text: parts.join('. ') + '.', type: data.sent > 0 ? 'success' : 'error' });
      setSlackQueue([]);
      setInviteOpen(false);
      loadData();
    } catch (e) {
      setMessage({ text: e.message, type: 'error' });
    } finally {
      setSlackSending(false);
    }
  }

  // -- User actions --

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

  // -- Groups --

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

  // -- Edit user --

  function openEditUser(u) {
    setEditUser(u);
    setEditForm({ name: u.name || '', email: u.email || '', username: u.username || '', userGroup: u.userGroup || '', role: u.role || 'user' });
  }

  async function saveEditUser() {
    if (!editUser) return;
    try {
      await adminApi('PATCH', `/v1/admin/users/${editUser.userId}`, {
        name: editForm.name,
        email: editForm.email,
        username: editForm.username,
        userGroup: editForm.userGroup || null,
      });
      if (editForm.role !== editUser.role) {
        await adminApi('PUT', `/v1/admin/users/${editUser.userId}/role`, { role: editForm.role });
      }
      setMessage({ text: 'User updated.', type: 'success' });
      setEditUser(null);
      loadData();
    } catch (e) { setMessage({ text: e.message, type: 'error' }); }
  }

  // -- Filtering, search, pagination --

  const combinedList = useMemo(() => {
    // Build unified list: invites first, then users
    const items = [];
    for (const inv of pendingInvites) {
      items.push({ _type: 'invite', _key: inv.inviteToken, email: inv.email, name: null, username: null, userGroup: null, role: null, createdAt: inv.createdAt, _invite: inv });
    }
    for (const u of users) {
      items.push({ _type: 'user', _key: u.userId, email: u.email, name: u.name, username: u.username, userGroup: u.userGroup, role: u.role, createdAt: u.createdAt, _user: u });
    }
    return items;
  }, [users, pendingInvites]);

  const filterCounts = useMemo(() => ({
    all: combinedList.length,
    active: combinedList.filter(i => i._type === 'user' && i.role === 'user').length,
    admins: combinedList.filter(i => i._type === 'user' && i.role === 'admin').length,
    invited: combinedList.filter(i => i._type === 'invite').length,
  }), [combinedList]);

  const filteredList = useMemo(() => {
    let list = combinedList;

    // Apply filter
    if (filter === 'active') list = list.filter(i => i._type === 'user' && i.role === 'user');
    else if (filter === 'admins') list = list.filter(i => i._type === 'user' && i.role === 'admin');
    else if (filter === 'invited') list = list.filter(i => i._type === 'invite');

    // Apply search
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(i =>
        (i.email && i.email.toLowerCase().includes(q)) ||
        (i.name && i.name.toLowerCase().includes(q)) ||
        (i.username && i.username.toLowerCase().includes(q))
      );
    }

    return list;
  }, [combinedList, filter, search]);

  const totalPages = Math.max(1, Math.ceil(filteredList.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageItems = filteredList.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  // Reset page when filter/search changes
  useEffect(() => { setPage(1); }, [filter, search]);

  if (loading) return <div className="flex items-center justify-center py-12 text-muted-foreground" role="status" aria-live="polite">Loading...</div>;

  // Edit user view
  if (editUser) {
    const isSelf = editUser.userId === currentUser?.userId;
    return (
      <div>
        <div className="flex items-center gap-3 mb-4">
          <Button variant="ghost" size="sm" onClick={() => setEditUser(null)} aria-label="Back to users">&larr; Back</Button>
          <h1 className="text-2xl font-bold">Edit User</h1>
        </div>
        {message && (
          <div className={`rounded-lg px-4 py-3 mb-4 text-sm ${message.type === 'error' ? 'bg-destructive/10 text-destructive' : 'bg-green-50 text-green-800'}`} role="alert">
            {message.text}
          </div>
        )}
        <Card>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-name">Name</Label>
              <Input id="edit-name" value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-email">Email</Label>
              <Input id="edit-email" type="email" value={editForm.email} onChange={e => setEditForm({ ...editForm, email: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-username">Username</Label>
              <Input id="edit-username" type="text" value={editForm.username} onChange={e => setEditForm({ ...editForm, username: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-group">User Group</Label>
              <select id="edit-group" value={editForm.userGroup}
                onChange={e => setEditForm({ ...editForm, userGroup: e.target.value })}
                className="h-10 w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm">
                <option value="">None</option>
                {groups.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            {!isSelf && (
              <div className="space-y-2">
                <Label htmlFor="edit-role">Role</Label>
                <select id="edit-role" value={editForm.role}
                  onChange={e => setEditForm({ ...editForm, role: e.target.value })}
                  className="h-10 w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm">
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
            )}
            <div className="flex items-center gap-3 pt-2">
              <Button onClick={saveEditUser}>Save</Button>
              <Button variant="outline" onClick={() => setEditUser(null)}>Cancel</Button>
              {!isSelf && (
                <Button variant="destructive" className="ml-auto" onClick={() => { setEditUser(null); deleteUser(editUser.userId, editUser.name || editUser.email); }}>
                  Delete User
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const filterButtons = [
    { key: 'all', label: 'All' },
    { key: 'active', label: 'Active' },
    { key: 'admins', label: 'Admins' },
    { key: 'invited', label: 'Invited' },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Users</h1>
        <div className="flex gap-2">
          <Button onClick={() => setInviteOpen(true)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Invite Users
          </Button>
          <Button variant="outline" onClick={() => setGroupsOpen(true)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            User Groups
          </Button>
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

      {/* Search and filters */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 mb-4">
        <Input
          type="text"
          placeholder="Search by email, username, or name..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="max-w-xs"
          aria-label="Search users"
        />
        <div className="flex gap-1" role="group" aria-label="Filter users">
          {filterButtons.map(f => (
            <Button
              key={f.key}
              variant={filter === f.key ? 'default' : 'outline'}
              size="default"
              onClick={() => setFilter(f.key)}
              aria-pressed={filter === f.key}
            >
              {f.label} <span className="ml-1 opacity-60">{filterCounts[f.key]}</span>
            </Button>
          ))}
        </div>
      </div>

      {filteredList.length > 0 ? (
        <>
          <div className="rounded-lg border overflow-hidden">
            <Table aria-label="Users and invites">
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Username</TableHead>
                  <TableHead>Group</TableHead>
                  <TableHead>Role</TableHead>
                  {slackConnected && <TableHead>Slack</TableHead>}
                  <TableHead>Date</TableHead>
                  <TableHead><span className="sr-only">Actions</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageItems.map(item => item._type === 'invite' ? (
                  <TableRow key={item._key}>
                    <TableCell className="text-muted-foreground">&mdash;</TableCell>
                    <TableCell>{item.email}</TableCell>
                    <TableCell className="text-muted-foreground">&mdash;</TableCell>
                    <TableCell>&mdash;</TableCell>
                    <TableCell><Badge variant="outline">Invited</Badge></TableCell>
                    {slackConnected && <TableCell className="text-muted-foreground">&mdash;</TableCell>}
                    <TableCell>{new Date(item.createdAt).toLocaleDateString()}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon-xs" title="Resend" aria-label={`Resend invite to ${item.email}`} onClick={() => resendInvite(item.email)}>&#8635;</Button>
                        <Button variant="ghost" size="icon-xs" title="Revoke" aria-label={`Revoke invite for ${item.email}`} onClick={() => revokeInvite(item._invite.inviteToken)}>&#10005;</Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  <TableRow key={item._key} className="cursor-pointer hover:bg-muted/50" onClick={() => openEditUser(item._user)} role="button" tabIndex={0} aria-label={`Edit ${item.name || item.email}`} onKeyDown={e => { if (e.key === 'Enter') openEditUser(item._user); }}>
                    <TableCell>{item.name}</TableCell>
                    <TableCell>{item.email}</TableCell>
                    <TableCell>{item.username || <span className="text-muted-foreground">&mdash;</span>}</TableCell>
                    <TableCell>{item.userGroup || <span className="text-muted-foreground">&mdash;</span>}</TableCell>
                    <TableCell>
                      <Badge variant={item.role === 'admin' ? 'default' : 'secondary'}>
                        {item.role === 'admin' ? 'Admin' : 'User'}
                      </Badge>
                    </TableCell>
                    {slackConnected && (
                      <TableCell>
                        {item._user.slackUserId ? (
                          <span title={item._user.slackUserId} className="text-xs">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="inline-block mr-1 text-muted-foreground" aria-label="Slack linked">
                              <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zm-1.27 0a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.163 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.163 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.163 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zm0-1.27a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.315A2.528 2.528 0 0 1 24 15.163a2.528 2.528 0 0 1-2.522 2.523h-6.315z" fill="currentColor"/>
                            </svg>
                            Linked
                          </span>
                        ) : <span className="text-muted-foreground">&mdash;</span>}
                      </TableCell>
                    )}
                    <TableCell>{new Date(item.createdAt).toLocaleDateString()}</TableCell>
                    <TableCell>
                      {item._user.userId !== currentUser?.userId && (
                        <Button variant="ghost" size="icon-xs" title="Delete" aria-label={`Delete ${item.name || item.email}`} onClick={(e) => { e.stopPropagation(); deleteUser(item._user.userId, item.name || item.email); }}>&#128465;</Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <nav className="flex items-center justify-center gap-3 mt-4" aria-label="Pagination">
              <Button variant="outline" size="sm" disabled={currentPage <= 1} onClick={() => setPage(p => p - 1)} aria-label="Previous page">
                Previous
              </Button>
              <span className="text-sm text-muted-foreground" aria-current="page">
                Page {currentPage} of {totalPages}
              </span>
              <Button variant="outline" size="sm" disabled={currentPage >= totalPages} onClick={() => setPage(p => p + 1)} aria-label="Next page">
                Next
              </Button>
            </nav>
          )}
        </>
      ) : (
        <p className="text-muted-foreground py-8 text-center">
          {search || filter !== 'all' ? 'No matching users.' : 'No users yet. Click "Invite Users" to get started.'}
        </p>
      )}

      {/* Invite Users Modal */}
      <Dialog open={inviteOpen} onOpenChange={handleInviteClose}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite Users</DialogTitle>
            <DialogDescription>
              {slackConnected
                ? 'Invite users via email or Slack DM.'
                : 'Add emails to invite. You can type multiple separated by commas or upload a CSV.'}
            </DialogDescription>
          </DialogHeader>

          {inviteNotice && (
            <p className="text-sm text-amber-600" role="status">{inviteNotice}</p>
          )}

          <Tabs defaultValue="email" value={inviteTab} onValueChange={(v) => { setInviteTab(v); setInviteNotice(null); if (v === 'slack' && slackChannels.length === 0) loadSlackChannels(); }}>
          {slackConnected && (
            <TabsList className="mb-4" aria-label="Invite method">
              <TabsTrigger value="email">Email</TabsTrigger>
              <TabsTrigger value="slack">Slack</TabsTrigger>
            </TabsList>
          )}

          {/* Email tab */}
          <TabsContent value="email">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="modal-inv-email">Email(s)</Label>
                <div className="flex gap-2">
                  <Input id="modal-inv-email" type="text" placeholder="user@example.com, another@example.com"
                    value={inviteInput} onChange={e => setInviteInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddEmails(); } }} className="flex-1" />
                  <Button variant="outline" onClick={handleAddEmails}>Add</Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="modal-csv">Or upload CSV</Label>
                <Input id="modal-csv" type="file" accept=".csv,text/csv" ref={csvRef} onChange={handleCsvFile} />
              </div>

              {emailQueue.length > 0 && (
                <div className="space-y-2">
                  <Label>Emails to invite ({emailQueue.length})</Label>
                  <div className="max-h-40 overflow-y-auto rounded-md border p-2">
                    <div className="flex flex-wrap gap-1.5">
                      {emailQueue.map(email => (
                        <span key={email} className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs">
                          {email}
                          <button
                            type="button"
                            onClick={() => removeFromQueue(email)}
                            className="ml-0.5 hover:text-destructive"
                            aria-label={`Remove ${email}`}
                          >
                            &#10005;
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <DialogFooter>
                <Button onClick={sendInvites} disabled={emailQueue.length === 0 || inviteSending}>
                  {inviteSending ? 'Sending...' : `Send ${emailQueue.length} invite(s)`}
                </Button>
              </DialogFooter>
            </div>
          </TabsContent>

          {/* Slack tab */}
          <TabsContent value="slack">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="slack-user-search">Search Slack users</Label>
                <Input
                  id="slack-user-search"
                  type="text"
                  placeholder="Search by name or email..."
                  value={slackSearch}
                  onChange={e => handleSlackSearchChange(e.target.value)}
                />
                {slackSearching && <p className="text-xs text-muted-foreground">Searching...</p>}
                {slackSearchResults.length > 0 && (
                  <div className="max-h-40 overflow-y-auto rounded-md border">
                    {slackSearchResults.map(u => (
                      <button
                        key={u.slackUserId}
                        type="button"
                        className="flex items-center gap-2 w-full px-3 py-2 text-left text-sm hover:bg-muted transition-colors"
                        onClick={() => addToSlackQueue(u)}
                      >
                        {u.avatar && <img src={u.avatar} alt="" className="w-6 h-6 rounded" />}
                        <span className="font-medium">{u.name}</span>
                        {u.email && <span className="text-muted-foreground text-xs ml-auto">{u.email}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="slack-channel-select">Or add from a channel</Label>
                <div className="flex gap-2">
                  <select
                    id="slack-channel-select"
                    value={slackSelectedChannel}
                    onChange={e => setSlackSelectedChannel(e.target.value)}
                    className="h-10 flex-1 rounded-lg border border-input bg-transparent px-3 py-2 text-sm"
                  >
                    <option value="">Select a channel...</option>
                    {slackChannels.map(ch => (
                      <option key={ch.id} value={ch.id}>#{ch.name} ({ch.memberCount} members)</option>
                    ))}
                  </select>
                  <Button variant="outline" onClick={() => loadChannelMembers(slackSelectedChannel)} disabled={!slackSelectedChannel || slackSearching}>
                    {slackSearching ? 'Loading...' : 'Add All'}
                  </Button>
                </div>
              </div>

              {slackQueue.length > 0 && (
                <div className="space-y-2">
                  <Label>Slack users to invite ({slackQueue.length})</Label>
                  <div className="max-h-40 overflow-y-auto rounded-md border p-2">
                    <div className="flex flex-wrap gap-1.5">
                      {slackQueue.map(u => (
                        <span key={u.slackUserId} className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs">
                          {u.name}
                          {!u.email && <span className="text-destructive" title="No email on Slack profile">&#9888;</span>}
                          <button
                            type="button"
                            onClick={() => removeFromSlackQueue(u.slackUserId)}
                            className="ml-0.5 hover:text-destructive"
                            aria-label={`Remove ${u.name}`}
                          >
                            &#10005;
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <DialogFooter>
                <Button onClick={sendSlackInvites} disabled={slackQueue.length === 0 || slackSending}>
                  {slackSending ? 'Sending...' : `Send ${slackQueue.length} Slack invite(s)`}
                </Button>
              </DialogFooter>
            </div>
          </TabsContent>
          </Tabs>
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
