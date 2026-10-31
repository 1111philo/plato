import { useEffect, useMemo, useState, useCallback } from 'react';
import { adminApi } from './adminApi.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { can } from '../../lib/permissions.js';
import ConfirmModal from '../../components/modals/ConfirmModal.jsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

/**
 * Admin → Notifications (#388, #389, #400): one place for everything plato
 * sends. Compose (a one-off message, in the classroom and/or by email),
 * Automations (on/off plus the email copy), History. Server:
 * routes/admin-notifications.js, lib/notifications.js, lib/messages.js.
 */

// In the order the Automations tab lists them.
const AVAILABLE = ['waitlistConfirmation', 'inactivityNudge', 'weeklyDigest'];
const AUTOMATION_TEMPLATE = { waitlistConfirmation: 'waitlist-confirmation', inactivityNudge: 'inactivity-nudge', weeklyDigest: 'weekly-digest' };
const MESSAGE_VARIABLES = ['firstName', 'classroomName'];

const vars = (list) => list.map((v) => `{{${v}}}`).join(', ');
const peopleCount = (n) => `${n} ${n === 1 ? 'person' : 'people'}`;

export default function AdminNotifications() {
  const { user } = useAuth();
  const canWrite = can(user, 'notifications.write');
  const [tab, setTab] = useState('compose');
  const [data, setData] = useState(null);
  const [messages, setMessages] = useState([]);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    const [settings, history] = await Promise.all([
      adminApi('GET', '/v1/admin/notifications'),
      adminApi('GET', '/v1/admin/notifications/messages'),
    ]);
    setData(settings);
    setMessages(history.messages || []);
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([adminApi('GET', '/v1/admin/notifications'), adminApi('GET', '/v1/admin/notifications/messages')])
      .then(([settings, history]) => { if (!cancelled) { setData(settings); setMessages(history.messages || []); } })
      .catch((e) => { if (!cancelled) setNotice({ text: e.message, type: 'error' }); });
    return () => { cancelled = true; };
  }, []);

  if (!data) {
    return <div className="flex items-center justify-center py-12 text-muted-foreground" role="status" aria-live="polite">{notice?.text || 'Loading...'}</div>;
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Notifications</h1>
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">{notice?.text || ''}</div>
      {notice && (
        <div className={`flex items-center justify-between rounded-lg px-4 py-3 mb-4 text-sm ${notice.type === 'error' ? 'bg-destructive/10 text-red-800 dark:text-destructive' : 'bg-green-50 text-green-800'}`}>
          <span>{notice.text}</span>
          <button onClick={() => setNotice(null)} aria-label="Dismiss" className="ml-2 text-lg leading-none hover:opacity-70">&times;</button>
        </div>
      )}
      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList aria-label="Notification sections">
          <TabsTrigger value="compose">Compose</TabsTrigger>
          <TabsTrigger value="automations">Automations</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>
        <TabsContent value="compose">
          <Compose canWrite={canWrite} onNotice={setNotice} onSent={async () => { await load(); setTab('history'); }} />
        </TabsContent>
        <TabsContent value="automations">
          <Automations data={data} canWrite={canWrite} onNotice={setNotice} onChange={setData} />
        </TabsContent>
        <TabsContent value="history">
          <History messages={messages} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Compose({ canWrite, onNotice, onSent }) {
  const [groups, setGroups] = useState([]);
  const [people, setPeople] = useState([]);
  const [type, setType] = useState('all');
  const [group, setGroup] = useState('');
  const [selected, setSelected] = useState([]);
  const [query, setQuery] = useState('');
  const [inApp, setInApp] = useState(true);
  const [email, setEmail] = useState(false);
  const [important, setImportant] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [preview, setPreview] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  // One id per message: a retried send is recognized and not sent twice.
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());

  useEffect(() => {
    let cancelled = false;
    fetch('/v1/groups').then((r) => r.json()).then((d) => { if (!cancelled) setGroups(d.userGroups || []); }).catch(() => {});
    adminApi('GET', '/v1/admin/users').then((list) => { if (!cancelled) setPeople(list); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const audience = useMemo(() => (
    type === 'group' ? { type, group } : type === 'users' ? { type, userIds: selected } : { type: 'all' }
  ), [type, group, selected]);
  const audienceReady = type === 'all' || (type === 'group' && group) || (type === 'users' && selected.length > 0);

  useEffect(() => {
    if (!audienceReady) return undefined;
    let cancelled = false;
    const t = setTimeout(() => {
      adminApi('POST', '/v1/admin/notifications/preview', { audience })
        .then((p) => { if (!cancelled) setPreview(p); })
        .catch(() => { if (!cancelled) setPreview(null); });
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [audience, audienceReady]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return people
      .filter((p) => !q || `${p.name || ''} ${p.email}`.toLowerCase().includes(q))
      .slice(0, 50);
  }, [people, query]);
  const nameOf = (id) => { const p = people.find((x) => x.userId === id); return p ? (p.name || p.email) : id; };
  const toggle = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  async function send() {
    setConfirming(false);
    setSending(true);
    try {
      await adminApi('POST', '/v1/admin/notifications/messages', { subject, body, inApp, email, important: inApp && important, audience, requestId });
      setRequestId(crypto.randomUUID());
      onNotice({ text: email ? 'Sent. Emails are going out now; History shows the counts.' : 'Sent.', type: 'success' });
      setSubject(''); setBody(''); setSelected([]);
      await onSent();
    } catch (e) {
      onNotice({ text: e.message, type: 'error' });
    } finally {
      setSending(false);
    }
  }

  const count = audienceReady ? preview?.count : null;
  const channels = [inApp && 'in the classroom', email && 'by email'].filter(Boolean).join(' and ');
  const radio = 'flex items-center gap-2 text-sm';

  return (
    <Card>
      <CardContent className="space-y-5">
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium mb-1">To</legend>
          <label className={radio}><input type="radio" name="audience" className="accent-primary" checked={type === 'all'} onChange={() => setType('all')} /> Everyone (all learners)</label>
          <label className={radio}><input type="radio" name="audience" className="accent-primary" checked={type === 'group'} onChange={() => setType('group')} disabled={!groups.length} /> A group</label>
          {type === 'group' && (
            <div className="pl-6">
              <Label htmlFor="compose-group" className="sr-only">Group</Label>
              <select id="compose-group" value={group} onChange={(e) => setGroup(e.target.value)} className="h-9 rounded-md border border-input bg-transparent px-3 text-sm">
                <option value="">Choose a group</option>
                {groups.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
          )}
          <label className={radio}><input type="radio" name="audience" className="accent-primary" checked={type === 'users'} onChange={() => setType('users')} /> Specific people</label>
          {type === 'users' && (
            <div className="pl-6 space-y-2">
              {selected.length > 0 && (
                <ul className="flex flex-wrap gap-1.5" aria-label="Chosen people">
                  {selected.map((id) => (
                    <li key={id} className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs">
                      {nameOf(id)}
                      <button type="button" onClick={() => toggle(id)} aria-label={`Remove ${nameOf(id)}`} className="leading-none hover:opacity-70">&times;</button>
                    </li>
                  ))}
                </ul>
              )}
              <Label htmlFor="compose-people-search">Find people</Label>
              <Input id="compose-people-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name or email" />
              <ul className="max-h-48 overflow-y-auto rounded-md border p-2 space-y-1" aria-label="People">
                {matches.map((p) => (
                  <li key={p.userId}>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" className="h-4 w-4" checked={selected.includes(p.userId)} onChange={() => toggle(p.userId)} />
                      <span>{p.name || p.email} <span className="text-muted-foreground">{p.email}</span></span>
                    </label>
                  </li>
                ))}
                {matches.length === 0 && <li className="text-sm text-muted-foreground">No one matches.</li>}
              </ul>
            </div>
          )}
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium mb-1">How</legend>
          <label className={radio}><input type="checkbox" className="h-4 w-4" checked={inApp} onChange={(e) => setInApp(e.target.checked)} /> In the classroom (the bell menu)</label>
          {inApp && (
            <label className={`${radio} pl-6`}><input type="checkbox" className="h-4 w-4" checked={important} onChange={(e) => setImportant(e.target.checked)} /> Also show it as a pop-up the next time they open the classroom</label>
          )}
          <label className={radio}><input type="checkbox" className="h-4 w-4" checked={email} onChange={(e) => setEmail(e.target.checked)} /> By email</label>
        </fieldset>

        <div className="space-y-2">
          <Label htmlFor="compose-subject">Subject</Label>
          <Input id="compose-subject" value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="compose-body">Message</Label>
          <Textarea id="compose-body" rows={6} value={body} maxLength={5000} onChange={(e) => setBody(e.target.value)} aria-describedby="compose-body-hint" />
          <p id="compose-body-hint" className="text-xs text-muted-foreground">You can use {vars(MESSAGE_VARIABLES)}. A blank line starts a new paragraph.</p>
        </div>

        <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
          {count == null ? '' : `Goes to ${peopleCount(count)}${email && preview?.emailOptedOut ? `; ${preview.emailOptedOut} turned off email` : ''}.`}
        </p>
        <Button onClick={() => setConfirming(true)} disabled={!canWrite || sending || !audienceReady || !subject.trim() || !body.trim() || (!inApp && !email) || !count}>
          {sending ? 'Sending…' : 'Send'}
        </Button>
        {!canWrite && <p className="text-xs text-muted-foreground">Only admins can send messages.</p>}
      </CardContent>
      <ConfirmModal
        open={confirming}
        onOpenChange={setConfirming}
        title={`Send to ${peopleCount(count || 0)}?`}
        message={`“${subject.trim()}” goes out ${channels} now. It can’t be unsent.`}
        confirmLabel="Send"
        variant="default"
        onConfirm={send}
      />
    </Card>
  );
}

function Automations({ data, canWrite, onNotice, onChange }) {
  const templates = Object.fromEntries(data.templates.map((t) => [t.id, t]));
  // Optimistic, so the checkbox answers at once; put back on failure.
  async function toggle(key, on) {
    const before = data.automations;
    onChange({ ...data, automations: { ...before, [key]: on } });
    try {
      const { automations } = await adminApi('PUT', '/v1/admin/notifications/automations', { [key]: on });
      onChange({ ...data, automations });
      onNotice({ text: `${templates[AUTOMATION_TEMPLATE[key]].label} is ${on ? 'on' : 'off'}.`, type: 'success' });
    } catch (e) {
      onChange({ ...data, automations: before });
      onNotice({ text: e.message, type: 'error' });
    }
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Emails plato sends on its own. Each one is off until you turn it on.</p>
      {AVAILABLE.map((key) => {
        const t = templates[AUTOMATION_TEMPLATE[key]];
        return (
          <Card key={key}>
            <CardHeader><CardTitle>{t.label}</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">{t.description}</p>
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" className="h-4 w-4" checked={!!data.automations[key]} disabled={!canWrite} onChange={(e) => toggle(key, e.target.checked)} />
                Send the {t.label.toLowerCase()} email
              </label>
              <TemplateEditor key={`${t.id}-${t.updatedAt || 'default'}`} template={t} canWrite={canWrite} onNotice={onNotice}
                onSaved={(next) => onChange({ ...data, templates: data.templates.map((x) => (x.id === next.id ? next : x)) })} />
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function TemplateEditor({ template, canWrite, onNotice, onSaved }) {
  const [subject, setSubject] = useState(template.subject);
  const [body, setBody] = useState(template.body);
  const [busy, setBusy] = useState('');
  const dirty = subject !== template.subject || body !== template.body;
  const id = template.id;

  async function run(kind, fn) {
    setBusy(kind);
    try { await fn(); } catch (e) { onNotice({ text: e.message, type: 'error' }); } finally { setBusy(''); }
  }
  const save = () => run('save', async () => {
    const { template: next } = await adminApi('PUT', `/v1/admin/notifications/templates/${id}`, { subject, body });
    onSaved(next);
    onNotice({ text: 'Email saved.', type: 'success' });
  });
  const reset = () => run('reset', async () => {
    const { template: next } = await adminApi('DELETE', `/v1/admin/notifications/templates/${id}`);
    onSaved(next);
    onNotice({ text: 'Back to plato’s default email.', type: 'success' });
  });
  const test = () => run('test', async () => {
    const r = await adminApi('POST', `/v1/admin/notifications/templates/${id}/test`, { subject, body });
    onNotice({ text: r.sent ? `Test sent to ${r.to}.` : r.blocked ? `Not sent: ${r.to} isn’t on this site’s email allowlist.` : `Email is turned off here, so nothing was sent to ${r.to}.`, type: r.sent ? 'success' : 'error' });
  });

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="space-y-2">
        <Label htmlFor={`${id}-subject`}>Subject</Label>
        <Input id={`${id}-subject`} value={subject} maxLength={200} disabled={!canWrite} onChange={(e) => setSubject(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${id}-body`}>Message</Label>
        <Textarea id={`${id}-body`} rows={7} value={body} maxLength={5000} disabled={!canWrite} onChange={(e) => setBody(e.target.value)} aria-describedby={`${id}-hint`} />
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          You can use {vars(template.variables)}.{template.variables.includes('link') ? ' Put {{link}} on its own line for a button.' : ''}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={save} disabled={!canWrite || !dirty || !!busy}>{busy === 'save' ? 'Saving…' : 'Save'}</Button>
        <Button size="sm" variant="outline" onClick={test} disabled={!canWrite || !!busy}>{busy === 'test' ? 'Sending…' : 'Send a test to me'}</Button>
        {!template.isDefault && <Button size="sm" variant="ghost" onClick={reset} disabled={!canWrite || !!busy}>Use the default</Button>}
      </div>
    </div>
  );
}

const AUDIENCE_LABEL = { all: 'Everyone', group: 'Group', users: 'People' };

function History({ messages }) {
  if (!messages.length) return <p className="text-sm text-muted-foreground">Nothing sent yet.</p>;
  return (
    <Card className="p-0 overflow-hidden">
      <Table aria-label="Sent messages">
        <TableHeader>
          <TableRow>
            <TableHead>Sent</TableHead>
            <TableHead>Subject</TableHead>
            <TableHead>To</TableHead>
            <TableHead>How</TableHead>
            <TableHead>Delivered</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {messages.map((m) => {
            const c = m.counts || {};
            const emailLine = m.email
              ? (m.status === 'sending' ? 'Emailing…' : `${c.emailed ?? 0} emailed${c.optedOut ? `, ${c.optedOut} opted out` : ''}${c.blocked ? `, ${c.blocked} not allowlisted` : ''}${c.failed ? `, ${c.failed} failed` : ''}`)
              : null;
            return (
              <TableRow key={m.id}>
                <TableCell className="whitespace-nowrap">{new Date(m.createdAt).toLocaleString()}<span className="block text-xs text-muted-foreground">{m.createdByName}</span></TableCell>
                <TableCell>{m.subject}{m.important && <span className="block text-xs text-muted-foreground">Pop-up</span>}</TableCell>
                <TableCell>{AUDIENCE_LABEL[m.audience?.type]}{m.audience?.type === 'group' ? `: ${m.audience.group}` : m.audience?.type === 'users' ? ` (${m.audience.userIds.length})` : ''}</TableCell>
                <TableCell>{[m.inApp && 'Classroom', m.email && 'Email'].filter(Boolean).join(', ')}</TableCell>
                <TableCell>{peopleCount(c.recipients ?? 0)}{emailLine && <span className="block text-xs text-muted-foreground">{emailLine}</span>}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}
