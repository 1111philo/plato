import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
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
import { PluginSlot } from '@/lib/plugins/Slot.jsx';
import UserStatsPanel from './UserStatsPanel.jsx';
import CompletionRing from './CompletionRing.jsx';
import UserFieldsDialog from './UserFieldsDialog.jsx';
import { can, isTester, normalizeRole, roleLabel, ROLES, ROLE_LABELS } from '../../lib/permissions.js';

// Shown under the role picker so the choice is informed (matrix: lib/permissions.js).
const ROLE_HELP = {
  admin: 'Full access, including settings, plugins, and roles.',
  educator: 'Creates and edits lessons, courses, and units; views learners and invites them.',
  learner: 'Takes lessons in the classroom. No dashboard access.',
  tester: 'Can open every classroom and dashboard page, but can’t change anything.',
};
import WaitlistDialog from './WaitlistDialog.jsx';
import WaitlistEntryEdit from './WaitlistEntryEdit.jsx';
import CustomFieldInput from '../../components/CustomFieldInput.jsx';
import { customFieldsMatch, missingRequired } from '../../lib/userFields.js';
import { toCsv, usersCsvRows } from '../../lib/csv.js';
import { buildFacets, matchesFilters, describeFilters } from '../../lib/userFilters.js';
import { visibleColumns, arrangeable, toggleColumn, moveColumn, loadPrefs, savePrefs, defaultPrefs } from '../../lib/tableColumns.js';
import FiltersMenu from './FiltersMenu.jsx';
import ColumnsDialog from './ColumnsDialog.jsx';
import GroupsDialog from './GroupsDialog.jsx';
import NameFields from '../../components/NameFields.jsx';

const PAGE_SIZE = 20;
const USER_COLUMNS_KEY = 'plato:columns:users:v1';

const SORT_LABELS = {
  name: 'last name', email: 'email', username: 'username',
  group: 'group', role: 'role', completed: 'completion',
  lastActive: 'last active', date: 'join date', userId: 'user ID',
};

// Module-level so the function references are stable across renders, which
// lets sortedList's useMemo cache correctly (and gets rid of the
// eslint-disable on exhaustive-deps). Items are the wrapper rows from
// combinedList — see _user for the underlying user record.
const SORT_KEY_FNS = {
  // Last name, then first (#402); people with one name sort by it.
  name: (i) => (i.name ? [i.lastName, i.firstName].filter(Boolean).join(' ') || i.name : i.email || ''),
  email: (i) => i.email || '',
  username: (i) => i.username || '',
  group: (i) => i.userGroup || '',
  role: (i) => i.role || '',
  completed: (i) => {
    const c = i._user?.lessonsCompleted;
    const a = i._user?.lessonsAvailable;
    if (typeof c !== 'number' || typeof a !== 'number' || a <= 0) return null;
    return c / a;
  },
  lastActive: (i) => i._user?.lastActiveAt || null,
  userId: (i) => i._user?.userId || null,
  date: (i) => i.createdAt || '',
};

/**
 * The keyboard/screen-reader way into a table row's edit view: a real button
 * in the first cell, whose name starts with the visible text. The row itself
 * stays clickable for the mouse. The button stops propagation so the click
 * doesn't fire twice.
 */
function RowOpenButton({ onClick, srPrefix, children }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="text-left font-medium hover:underline cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <span className="sr-only">{srPrefix}</span>{children}
    </button>
  );
}

function SortHeader({ sortKey, sortBy, onSort, align = 'left', children }) {
  const active = sortBy.key === sortKey;
  const aria = !active ? 'none' : sortBy.dir === 'asc' ? 'ascending' : 'descending';
  const cellAlign = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : '';
  const btnAlign = align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center w-full' : '';
  return (
    <TableHead aria-sort={aria} className={cellAlign}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 font-medium hover:text-foreground rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-1 ${btnAlign}`}
      >
        {children}
        <span aria-hidden="true" className={`text-xs ${active ? '' : 'opacity-30'}`}>
          {active ? (sortBy.dir === 'asc' ? '↑' : '↓') : '↕'}
        </span>
      </button>
    </TableHead>
  );
}

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
  const navigate = useNavigate();
  const { userId: paramUserId, waitlistToken } = useParams();
  const { user: currentUser } = useAuth();
  // Controls render if the role can use them, or for testers (who explore
  // everything; their writes are refused with a clear message). Educators
  // don't see what they can't use.
  const shows = (permission) => can(currentUser, permission) || isTester(currentUser);
  const [users, setUsers] = useState([]);
  const [pendingInvites, setPendingInvites] = useState([]);
  const [waitlistEntries, setWaitlistEntries] = useState([]);
  const [waitlistSettings, setWaitlistSettings] = useState({ open: false, hasApiKey: false });
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);

  // Modal states
  const [inviteOpen, setInviteOpen] = useState(false);
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const [waitlistOpen, setWaitlistOpen] = useState(false);
  const [userFields, setUserFields] = useState([]);
  const [editUser, setEditUser] = useState(null);
  const [editForm, setEditForm] = useState({ firstName: '', lastName: '', email: '', username: '', userGroup: '', role: '', customFields: {} });

  // Invite modal state
  const [inviteInput, setInviteInput] = useState('');
  const [emailQueue, setEmailQueue] = useState([]);
  const [inviteSending, setInviteSending] = useState(false);
  const [inviteNotice, setInviteNotice] = useState(null);
  const csvRef = useRef(null);

  // Search, filter, pagination
  const [search, setSearch] = useState('');
  // Combined filters (#362): { [facetKey]: [values] }; see lib/userFilters.js.
  const [filters, setFilters] = useState({});
  // Column layout (#385), saved in this browser; see lib/tableColumns.js.
  const [columnPrefs, setColumnPrefs] = useState(() => loadPrefs(`${USER_COLUMNS_KEY}:${currentUser?.userId || "anon"}`));
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState({ key: 'name', dir: 'asc' });
  const [sortAnnouncement, setSortAnnouncement] = useState('');


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

  // Link invite state
  const [linkInvite, setLinkInvite] = useState(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [linkGenerating, setLinkGenerating] = useState(false);

  // `quiet` refreshes without the page spinner, which would unmount an open dialog.
  const loadData = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      const [usersRes, invitesRes, settingsRes, pluginsRes, linkRes, waitlistRes] = await Promise.all([
        adminApi('GET', '/v1/admin/users?include=stats'),
        adminApi('GET', '/v1/admin/invites'),
        adminApi('GET', '/v1/admin/settings'),
        adminApi('GET', '/v1/admin/plugins').catch(() => []),
        adminApi('GET', '/v1/admin/invites/link').catch(() => null),
        adminApi('GET', '/v1/admin/waitlist').catch(() => null),
      ]);
      setUsers(Array.isArray(usersRes) ? usersRes : []);
      setPendingInvites(Array.isArray(invitesRes) ? invitesRes.filter(x => x.status === 'pending') : []);
      setGroups(settingsRes.userGroups || []);
      setUserFields(Array.isArray(settingsRes.userFields) ? settingsRes.userFields : []);
      setLinkInvite(linkRes);
      setWaitlistEntries(Array.isArray(waitlistRes?.entries) ? waitlistRes.entries : []);
      setWaitlistSettings({ open: !!waitlistRes?.open, hasApiKey: !!waitlistRes?.hasApiKey });
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
    for (const inv of pendingInvites) {
      if (inv.email) set.add(inv.email.toLowerCase()); // Skip link invites (email is null)
    }
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

  // -- Link invite handlers --

  async function handleGenerateLink() {
    setLinkGenerating(true);
    try {
      const data = await adminApi('POST', '/v1/admin/invites/link');
      setLinkInvite(data);
      setMessage({ text: 'Invite link generated', type: 'success' });
    } catch (e) {
      setMessage({ text: e.message, type: 'error' });
    } finally {
      setLinkGenerating(false);
    }
  }

  async function handleRegenerateLink() {
    if (!confirm('Regenerate invite link? The old link will stop working.')) return;
    await handleGenerateLink();
  }

  async function handleDeleteLink() {
    if (!confirm('Delete invite link? This cannot be undone.')) return;
    try {
      await adminApi('DELETE', '/v1/admin/invites/link');
      setLinkInvite(null);
      setMessage({ text: 'Invite link deleted', type: 'success' });
    } catch (e) {
      setMessage({ text: e.message, type: 'error' });
    }
  }

  function handleCopyLink() {
    const url = `${window.location.origin}/signup?token=${linkInvite.inviteToken}`;
    navigator.clipboard.writeText(url);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  }

  // -- User actions --

  async function resendInvite(email) {
    try {
      await adminApi('POST', '/v1/admin/invites/resend', { email });
      setMessage({ text: `Invite resent to ${email}.`, type: 'success' });
      loadData();
    } catch (e) { setMessage({ text: e.message, type: 'error' }); }
  }

  async function inviteFromWaitlist(token, email) {
    try {
      await adminApi('POST', `/v1/admin/waitlist/${token}/invite`);
      setMessage({ text: `Invite sent to ${email}.`, type: 'success' });
      loadData();
      return true;
    } catch (e) { setMessage({ text: e.message, type: 'error' }); return false; }
  }

  async function removeFromWaitlist(token, email) {
    if (!confirm(`Remove ${email} from the wait list?`)) return false;
    try { await adminApi('DELETE', `/v1/admin/waitlist/${token}`); loadData(); return true; }
    catch (e) { setMessage({ text: e.message, type: 'error' }); return false; }
  }

  // -- Edit a wait-list entry (#363) --
  // Driven by the URL (/plato/users/waitlist/:token), like Edit User.
  const editEntry = waitlistToken ? waitlistEntries.find((w) => w.inviteToken === waitlistToken) || null : null;
  useEffect(() => {
    // Stale link (invited/removed since): back to the list once data is in.
    if (waitlistToken && !loading && !editEntry) navigate('/plato/users', { replace: true });
  }, [waitlistToken, loading, editEntry, navigate]);

  async function revokeInvite(token) {
    try { await adminApi('DELETE', `/v1/admin/invites/${token}`); loadData(); } catch { /* ignore */ }
  }

  async function deleteUser(userId, name) {
    if (!confirm(`Delete ${name} and all their data? This cannot be undone.`)) return;
    try { await adminApi('DELETE', `/v1/admin/users/${userId}`); loadData(); }
    catch (e) { setMessage({ text: e.message, type: 'error' }); }
  }

  async function resetUserPassword(userId, email) {
    if (!confirm(`Send a password reset email to ${email}?`)) return;
    try {
      await adminApi('POST', `/v1/admin/users/${userId}/reset-password`);
      setMessage({ text: `Password reset email sent to ${email}.`, type: 'success' });
    } catch (e) {
      setMessage({ text: e.message, type: 'error' });
    }
  }

  // -- Groups --

  // -- Edit user --
  // editUser is driven by the URL (/plato/users/:userId) so deep-linking and
  // browser refresh / back-button preserve the selection. openEditUser only
  // navigates; the effect below populates state from the URL param + users list.

  function openEditUser(u) {
    navigate(`/plato/users/${u.userId}`);
  }

  function closeEditUser() {
    navigate('/plato/users');
  }

  useEffect(() => {
    if (!paramUserId) {
      setEditUser(null);
      return;
    }
    // Wait until users have loaded; if userId doesn't resolve to a known user,
    // route back to the list (e.g. stale URL pointing at a deleted user).
    if (users.length === 0) return;
    const u = users.find((x) => x.userId === paramUserId);
    if (!u) {
      navigate('/plato/users', { replace: true });
      return;
    }
    setEditUser(u);
    setEditForm({ firstName: u.firstName || '', lastName: u.lastName || '', email: u.email || '', username: u.username || '', userGroup: u.userGroup || '', role: u.role || 'user', customFields: { ...(u.customFields || {}) } });
  }, [paramUserId, users, navigate]);

  async function saveEditUser() {
    if (!editUser) return;
    const missing = missingRequired(userFields, editForm.customFields);
    if (missing.length) {
      const labels = userFields.filter(f => missing.includes(f.id)).map(f => f.label);
      setMessage({ text: `Fill in required ${labels.length === 1 ? 'field' : 'fields'}: ${labels.join(', ')}.`, type: 'error' });
      return;
    }
    try {
      await adminApi('PATCH', `/v1/admin/users/${editUser.userId}`, {
        firstName: editForm.firstName,
        lastName: editForm.lastName,
        email: editForm.email,
        username: editForm.username,
        userGroup: editForm.userGroup || null,
        // Send every defined field so cleared inputs clear the stored value.
        customFields: Object.fromEntries(userFields.map((f) => [f.id, editForm.customFields[f.id] ?? ''])),
      });
      if (normalizeRole(editForm.role) !== normalizeRole(editUser.role)) {
        await adminApi('PUT', `/v1/admin/users/${editUser.userId}/role`, { role: editForm.role });
      }
      setMessage({ text: 'User updated.', type: 'success' });
      closeEditUser();
      loadData();
    } catch (e) { setMessage({ text: e.message, type: 'error' }); }
  }

  // -- Filtering, search, pagination --

  const combinedList = useMemo(() => {
    // Build unified list: invites first, then users
    // Filter out link invites (shown in the Link tab, not the user list)
    const items = [];
    for (const inv of pendingInvites) {
      if (!inv.isLink) {
        items.push({ _type: 'invite', _key: inv.inviteToken, email: inv.email, name: null, firstName: null, lastName: null, username: null, userGroup: null, role: null, customFields: null, createdAt: inv.createdAt, _invite: inv });
      }
    }
    for (const w of waitlistEntries) {
      items.push({ _type: 'waitlist', _key: w.inviteToken, email: w.email, name: w.name, firstName: w.firstName, lastName: w.lastName, username: null, userGroup: w.userGroup, role: null, customFields: w.customFields || {}, createdAt: w.createdAt, _entry: w });
    }
    for (const u of users) {
      items.push({ _type: 'user', _key: u.userId, email: u.email, name: u.name, firstName: u.firstName, lastName: u.lastName, username: u.username, userGroup: u.userGroup, role: u.role, customFields: u.customFields || {}, createdAt: u.createdAt, _user: u });
    }
    return items;
  }, [users, pendingInvites, waitlistEntries]);

  // People (and wait-list entries) per group, for the User Groups dialog.
  const groupCounts = useMemo(() => {
    const counts = {};
    for (const i of combinedList) if (i._type !== 'invite' && i.userGroup) counts[i.userGroup] = (counts[i.userGroup] || 0) + 1;
    return counts;
  }, [combinedList]);
  const facets = useMemo(() => buildFacets({ items: combinedList, groups, userFields }), [combinedList, groups, userFields]);
  const filterChips = describeFilters(filters, facets);

  const filteredList = useMemo(() => {
    let list = combinedList.filter((i) => matchesFilters(i, filters, facets));

    // Apply search (custom field values are searchable too)
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(i =>
        (i.email && i.email.toLowerCase().includes(q)) ||
        (i.name && i.name.toLowerCase().includes(q)) ||
        (i.username && i.username.toLowerCase().includes(q)) ||
        (i._user?.userId && i._user.userId.toLowerCase().includes(q)) ||
        customFieldsMatch(i.customFields, q)
      );
    }

    return list;
  }, [combinedList, filters, facets, search]);

  // Sort comparators live at module level (SORT_KEY_FNS) so their references
  // are stable; nullish values always sort last regardless of direction so
  // invites (which lack user-stat fields) cluster predictably rather than
  // ping-ponging between top and bottom on direction flip.
  const sortedList = useMemo(() => {
    const keyFn = SORT_KEY_FNS[sortBy.key] || SORT_KEY_FNS.name;
    const mult = sortBy.dir === 'desc' ? -1 : 1;
    return [...filteredList].sort((a, b) => {
      const va = keyFn(a);
      const vb = keyFn(b);
      const aNull = va == null || va === '';
      const bNull = vb == null || vb === '';
      if (aNull && bNull) return 0;
      if (aNull) return 1;   // nullish always last
      if (bNull) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * mult;
      return va.toString().localeCompare(vb.toString(), undefined, { numeric: true, sensitivity: 'base' }) * mult;
    });
  }, [filteredList, sortBy]);

  // CSV of the list as shown (current filter, search, sort) — see lib/csv.js.
  function downloadCsv() {
    const blob = new Blob(['\uFEFF' + toCsv(usersCsvRows(sortedList, userFields))], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `plato-users-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Revoking synchronously can cancel the download in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  const totalPages = Math.max(1, Math.ceil(sortedList.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageItems = sortedList.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  function handleSort(key) {
    setSortBy((prev) => {
      const next = prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'asc' };
      // Announcement goes via setState so SRs hear it from the live region.
      // We update it from the same click handler (not an effect) so the
      // message is in sync with the visible sort and we don't cascade re-renders.
      const label = SORT_LABELS[next.key] || next.key;
      setSortAnnouncement(`Sorted by ${label}, ${next.dir === 'asc' ? 'ascending' : 'descending'}.`);
      return next;
    });
  }


  // Reset page when filter/search/sort changes
  useEffect(() => { setPage(1); }, [filters, search, sortBy]);

  if (loading) return <div className="flex items-center justify-center py-12 text-muted-foreground" role="status" aria-live="polite">Loading...</div>;

  if (editEntry) {
    const back = () => navigate('/plato/users');
    return (
      <WaitlistEntryEdit
        key={editEntry.inviteToken}
        entry={editEntry}
        groups={groups}
        userFields={userFields}
        onBack={back}
        onSaved={(text) => { setMessage({ text, type: 'success' }); back(); loadData(); }}
        onInvite={async (e) => { if (await inviteFromWaitlist(e.inviteToken, e.email)) back(); }}
        onRemove={async (e) => { if (await removeFromWaitlist(e.inviteToken, e.email)) back(); }}
        canEdit={shows('waitlist.write')}
        canInvite={shows('waitlist.invite')}
      />
    );
  }

  // Edit user view
  if (editUser) {
    const isSelf = editUser.userId === currentUser?.userId;
    const canEditUser = shows('users.write');
    return (
      <div>
        <div className="flex items-center gap-3 mb-4">
          <Button variant="ghost" size="sm" onClick={closeEditUser} aria-label="Back to users">&larr; Back</Button>
          <h1 className="text-2xl font-bold">Edit User</h1>
        </div>
        {message && (
          <div className={`rounded-lg px-4 py-3 mb-4 text-sm ${message.type === 'error' ? 'bg-destructive/10 text-destructive' : 'bg-green-50 text-green-800'}`} role="alert">
            {message.text}
          </div>
        )}
        <Card>
          <CardContent className="space-y-4">
            <NameFields
              idPrefix="edit"
              disabled={!canEditUser}
              inferred={editUser.nameSource === 'auto'}
              value={{ firstName: editForm.firstName, lastName: editForm.lastName }}
              onChange={(n) => setEditForm({ ...editForm, ...n })}
            />
            <div className="space-y-2">
              <Label htmlFor="edit-email">Email</Label>
              <Input id="edit-email" disabled={!canEditUser} type="email" value={editForm.email} onChange={e => setEditForm({ ...editForm, email: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-username">Username</Label>
              <Input id="edit-username" disabled={!canEditUser} type="text" value={editForm.username} onChange={e => setEditForm({ ...editForm, username: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-group">User Group</Label>
              <select id="edit-group" value={editForm.userGroup} disabled={!canEditUser}
                onChange={e => setEditForm({ ...editForm, userGroup: e.target.value })}
                className="h-10 w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm">
                <option value="">None</option>
                {groups.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            {userFields.map(f => (
              <CustomFieldInput
                key={f.id}
                field={f}
                idPrefix="edit-field"
                value={editForm.customFields[f.id]}
                onChange={(v) => setEditForm(prev => ({ ...prev, customFields: { ...prev.customFields, [f.id]: v } }))}
                disabled={!canEditUser}
              />
            ))}
            {!isSelf && shows('users.role') && (
              <div className="space-y-2">
                <Label htmlFor="edit-role">Role</Label>
                <select id="edit-role" value={normalizeRole(editForm.role)}
                  onChange={e => setEditForm({ ...editForm, role: e.target.value })}
                  aria-describedby="edit-role-help"
                  className="h-10 w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm">
                  {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                </select>
                <p id="edit-role-help" className="text-xs text-muted-foreground">{ROLE_HELP[normalizeRole(editForm.role)]}</p>
              </div>
            )}
            <div className="flex items-center gap-3 pt-2">
              {canEditUser && <Button onClick={saveEditUser}>Save</Button>}
              <Button variant="outline" onClick={closeEditUser}>{canEditUser ? 'Cancel' : 'Back'}</Button>
              {!isSelf && canEditUser && (
                <>
                  <Button variant="outline" className="ml-auto" onClick={() => resetUserPassword(editUser.userId, editUser.email)}>
                    Reset Password
                  </Button>
                  <Button variant="destructive" onClick={() => { closeEditUser(); deleteUser(editUser.userId, editUser.name || editUser.email); }}>
                    Delete User
                  </Button>
                </>
              )}
            </div>
            <PluginSlot name="adminProfileFields" context={{ user: editUser }} />
          </CardContent>
        </Card>
        <div className="mt-4">
          <UserStatsPanel key={editUser.userId} userId={editUser.userId} />
        </div>
      </div>
    );
  }

  // Table columns (#385). `fixed` ones always show, at the ends; the rest
  // follow the admin's saved layout (Columns dialog). Every custom field is a
  // column too, hidden until chosen.
  const DASH = <span className="text-muted-foreground">&mdash;</span>;
  const allColumns = [
    { id: 'name', label: 'Name', fixed: true, sortKey: 'name', cell: (item) => (
      item._type === 'waitlist' ? <RowOpenButton onClick={() => navigate(`/plato/users/waitlist/${item._key}`)} srPrefix="Edit wait list entry: ">{item.name || item.email}</RowOpenButton>
        : item._type === 'user' ? <RowOpenButton onClick={() => openEditUser(item._user)} srPrefix="Edit ">{item.name || item.email}</RowOpenButton>
          : DASH
    ) },
    { id: 'email', label: 'Email', sortKey: 'email', cell: (item) => item.email },
    { id: 'username', label: 'Username', sortKey: 'username', cell: (item) => (item._type === 'user' && item.username) || DASH },
    { id: 'group', label: 'Group', sortKey: 'group', cell: (item) => (item._type !== 'invite' && item.userGroup) || DASH },
    { id: 'role', label: 'Role', sortKey: 'role', cell: (item) => (
      item._type === 'waitlist' ? (
        <>
          <Badge variant="outline">Wait List</Badge>
          {item._entry.alreadyRegistered && (
            <span className="block text-xs text-muted-foreground mt-1">{item._entry.alreadyRegistered === 'account' ? 'Has an account' : 'Invited'}</span>
          )}
        </>
      )
        : item._type === 'invite' ? <Badge variant="outline">Invited</Badge>
          : <Badge variant={normalizeRole(item.role) === 'learner' ? 'secondary' : 'default'}>{roleLabel(item.role)}</Badge>
    ) },
    { id: 'completed', label: 'Completed', sortKey: 'completed', align: 'center', cellClass: 'text-center', cell: (item) => (
      item._type === 'user' && typeof item._user.lessonsCompleted === 'number'
        ? <div className="inline-flex"><CompletionRing completed={item._user.lessonsCompleted} available={item._user.lessonsAvailable} size={40} strokeWidth={5} compact /></div>
        : DASH
    ) },
    { id: 'lastActive', label: 'Last active', sortKey: 'lastActive', cell: (item) => (item._type === 'user' && item._user.lastActiveAt ? new Date(item._user.lastActiveAt).toLocaleDateString() : DASH) },
    { id: 'date', label: 'Date added', sortKey: 'date', cell: (item) => (item._type === 'waitlist' ? new Date(item.createdAt).toLocaleString() : new Date(item.createdAt).toLocaleDateString()) },
    ...userFields.map((f) => ({
      id: `field:${f.id}`, label: f.label, defaultHidden: true, cellClass: 'max-w-48 truncate',
      cell: (item) => (item._type !== 'invite' && item.customFields?.[f.id]) || DASH,
    })),
    ...(slackConnected ? [{ id: 'slack', label: 'Slack', cell: (item) => (item._type === 'user' && item._user.slackUserId ? (
      <span title={item._user.slackUserId} className="text-xs">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="inline-block mr-1 text-muted-foreground" aria-label="Slack linked">
                              <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zm-1.27 0a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.163 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.163 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.163 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zm0-1.27a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.315A2.528 2.528 0 0 1 24 15.163a2.528 2.528 0 0 1-2.522 2.523h-6.315z" fill="currentColor"/>
                            </svg>
        Linked
      </span>
    ) : DASH) }] : []),
    // The immutable account id, for research and reporting (#386). Staff only
    // (admins, educators, testers: everyone with users.read); never learners.
    { id: 'userId', label: 'User ID', sortKey: 'userId', cell: (item) => (item._type === 'user' ? <code className="text-xs">{item._user.userId}</code> : DASH) },
    { id: 'actions', label: 'Actions', fixed: true, cell: (item) => (
      item._type === 'waitlist' ? (
        <div className="flex gap-1">
          {/* Someone who already has an account can't be invited again. */}
          {shows('waitlist.invite') && item._entry.alreadyRegistered !== 'account' && <Button variant="outline" size="xs" aria-label={`Invite ${item.email}`} onClick={(e) => { e.stopPropagation(); inviteFromWaitlist(item._key, item.email); }}>Invite</Button>}
          {shows('waitlist.write') && <Button variant="ghost" size="icon-xs" title="Remove" aria-label={`Remove ${item.email} from the wait list`} onClick={(e) => { e.stopPropagation(); removeFromWaitlist(item._key, item.email); }}>&#10005;</Button>}
        </div>
      ) : item._type === 'invite' ? (
        <div className="flex gap-1">
          <Button variant="ghost" size="icon-xs" title="Resend" aria-label={`Resend invite to ${item.email}`} onClick={() => resendInvite(item.email)}>&#8635;</Button>
          <Button variant="ghost" size="icon-xs" title="Revoke" aria-label={`Revoke invite for ${item.email}`} onClick={() => revokeInvite(item._invite.inviteToken)}>&#10005;</Button>
        </div>
      ) : (
        // Keep clicks on these buttons from also opening the row.
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <PluginSlot name="adminUserRowAction" context={{ user: item._user }} />
          {item._user.userId !== currentUser?.userId && shows('users.write') && (
            <Button variant="ghost" size="icon-xs" title="Delete" aria-label={`Delete ${item.name || item.email}`} onClick={(e) => { e.stopPropagation(); deleteUser(item._user.userId, item.name || item.email); }}>&#128465;</Button>
          )}
        </div>
      )
    ) },
  ];
  const shownColumns = visibleColumns(allColumns, columnPrefs);
  const updateColumns = (next) => { setColumnPrefs(next); savePrefs(`${USER_COLUMNS_KEY}:${currentUser?.userId || "anon"}`, next); };

  return (
    <div>
      {/* Wraps on narrow screens; without it the trailing buttons ran off-screen on phones. */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h1 className="text-2xl font-bold">Users</h1>
        <div className="flex flex-wrap gap-2">
          {shows('invites.write') && <Button onClick={() => setInviteOpen(true)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Invite Users
          </Button>}
          {shows('groups.write') && <Button variant="outline" onClick={() => setGroupsOpen(true)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            User Groups
          </Button>}
          {shows('fields.write') && <Button variant="outline" onClick={() => setFieldsOpen(true)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
            User Fields
          </Button>}
          {shows('waitlist.write') && <Button variant="outline" onClick={() => setWaitlistOpen(true)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            Wait List
          </Button>}
          <Button variant="outline" onClick={downloadCsv}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Download CSV
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
          placeholder={userFields.length ? 'Search by email, username, name, or field...' : 'Search by email, username, or name...'}
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="max-w-xs"
          aria-label="Search users"
        />
        <FiltersMenu facets={facets} filters={filters} onChange={setFilters} />
        <Button variant="outline" onClick={() => setColumnsOpen(true)}>Columns</Button>
        <span className="text-sm text-muted-foreground" role="status" aria-live="polite">
          {filteredList.length === combinedList.length ? `${combinedList.length} people` : `${filteredList.length} of ${combinedList.length} people`}
        </span>
      </div>
      {filterChips.length > 0 && (
        <ul className="flex flex-wrap items-center gap-2 mb-4" aria-label="Filters on">
          {filterChips.map((chip) => (
            <li key={chip.key} className="inline-flex items-center gap-1 rounded-full border bg-muted/50 px-3 py-1 text-xs">
              <span><span className="font-medium">{chip.label}:</span> {chip.values.join(', ')}</span>
              <button type="button" className="ml-1 leading-none hover:opacity-70" aria-label={`Remove the ${chip.label} filter`}
                onClick={() => setFilters((prev) => ({ ...prev, [chip.key]: [] }))}>&times;</button>
            </li>
          ))}
          <li><Button variant="ghost" size="xs" onClick={() => setFilters({})}>Clear all</Button></li>
        </ul>
      )}

      {/* Polite live region announces sort changes for screen-reader users
          (aria-sort attribute changes aren't reliably announced by NVDA/JAWS). */}
      <div role="status" aria-live="polite" className="sr-only">{sortAnnouncement}</div>

      {filteredList.length > 0 ? (
        <>
          <div className="rounded-lg border overflow-hidden">
            <Table aria-label="Users and invites">
              <TableHeader>
                <TableRow>
                  {shownColumns.map((col) => (col.sortKey
                    ? <SortHeader key={col.id} sortKey={col.sortKey} sortBy={sortBy} onSort={handleSort} align={col.align}>{col.label}</SortHeader>
                    : <TableHead key={col.id}>{col.id === 'actions' ? <span className="sr-only">Actions</span> : col.label}</TableHead>))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageItems.map((item) => {
                  // Clicking anywhere on a user or wait-list row is a mouse
                  // convenience; the name button is the keyboard/SR path. (A
                  // role="button" row can't contain the row's own buttons.)
                  const open = item._type === 'waitlist' ? () => navigate(`/plato/users/waitlist/${item._key}`)
                    : item._type === 'user' ? () => openEditUser(item._user) : null;
                  return (
                    <TableRow key={item._key} className={open ? 'cursor-pointer hover:bg-muted/50' : undefined} onClick={open || undefined}>
                      {shownColumns.map((col) => <TableCell key={col.id} className={col.cellClass}>{col.cell(item)}</TableCell>)}
                    </TableRow>
                  );
                })}
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
          {search || filterChips.length ? 'No matching users.' : 'No users yet. Click "Invite Users" to get started.'}
        </p>
      )}

      <ColumnsDialog
        open={columnsOpen}
        onOpenChange={setColumnsOpen}
        title="Users table columns"
        columns={arrangeable(allColumns, columnPrefs)}
        onToggle={(id, show) => updateColumns(toggleColumn(allColumns, columnPrefs, id, show))}
        onMove={(id, delta) => updateColumns(moveColumn(allColumns, columnPrefs, id, delta))}
        onReset={() => updateColumns(defaultPrefs(allColumns))}
      />

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
            <TabsList className="mb-4" aria-label="Invite method">
              <TabsTrigger value="email" aria-label="Invite via email">Email</TabsTrigger>
              {slackConnected && <TabsTrigger value="slack" aria-label="Invite via Slack">Slack</TabsTrigger>}
              <TabsTrigger value="link" aria-label="Invite via shareable link">Link</TabsTrigger>
            </TabsList>

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

          {/* Link tab */}
          <TabsContent value="link">
            {linkInvite ? (
              <div className="space-y-4">
                <div className="rounded-lg border p-4 bg-muted/50">
                  <Label htmlFor="invite-link">Shareable Invite Link</Label>
                  <div className="flex gap-2 mt-2">
                    <Input
                      id="invite-link"
                      readOnly
                      value={`${window.location.origin}/signup?token=${linkInvite.inviteToken}`}
                      className="font-mono text-sm"
                    />
                    <Button onClick={handleCopyLink} variant="outline">
                      {linkCopied ? 'Copied!' : 'Copy'}
                    </Button>
                  </div>
                </div>

                <div className="text-sm text-muted-foreground space-y-1">
                  <p>Created: {new Date(linkInvite.createdAt).toLocaleDateString()}</p>
                  <p>Used by: {linkInvite.usageCount || 0} {(linkInvite.usageCount || 0) === 1 ? 'person' : 'people'}</p>
                  <p>Expires: {new Date(linkInvite.ttl * 1000).toLocaleDateString()}</p>
                </div>

                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <p className="text-sm text-amber-900">
                    <strong>Security note:</strong> Anyone with this link can create an account.
                    Only share it in trusted channels. Regenerate to revoke the old link.
                  </p>
                </div>

                <DialogFooter>
                  <Button variant="outline" onClick={handleDeleteLink}>
                    Delete Link
                  </Button>
                  <Button onClick={handleRegenerateLink} disabled={linkGenerating}>
                    {linkGenerating ? 'Regenerating...' : 'Regenerate Link'}
                  </Button>
                </DialogFooter>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Create a shareable invite link that anyone can use to sign up.
                  The link expires after 7 days and can be regenerated anytime.
                </p>

                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <p className="text-sm text-amber-900">
                    <strong>Security note:</strong> Anyone with this link can create an account.
                    Only share it in trusted channels.
                  </p>
                </div>

                <DialogFooter>
                  <Button onClick={handleGenerateLink} disabled={linkGenerating}>
                    {linkGenerating ? 'Generating...' : 'Generate Invite Link'}
                  </Button>
                </DialogFooter>
              </div>
            )}
          </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* User Groups Modal */}
      <UserFieldsDialog
        open={fieldsOpen}
        onOpenChange={setFieldsOpen}
        fields={userFields}
        onChange={(next) => {
          setUserFields(next);
          // Reset a filter pointing at a deleted field.
          // Drop filters on a deleted field.
          setFilters((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => !k.startsWith('field:') || next.some((f) => `field:${f.id}` === k))));
          // Values for deleted fields were erased server-side; refresh rows.
          if (next.length < userFields.length) loadData();
        }}
      />

      <WaitlistDialog
        open={waitlistOpen}
        onOpenChange={setWaitlistOpen}
        settings={waitlistSettings}
        onChange={setWaitlistSettings}
      />

      <GroupsDialog
        open={groupsOpen}
        onOpenChange={setGroupsOpen}
        groups={groups}
        memberCounts={groupCounts}
        onChanged={(next) => { setGroups(next); loadData({ quiet: true }); }}
      />
    </div>
  );
}
