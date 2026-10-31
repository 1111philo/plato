/**
 * Slack settings panel — rendered as the `adminSettingsPanel` slot inside the
 * plugin card on /plato/plugins.
 *
 * Props (per the SettingsPanel slot contract):
 *   - pluginId: 'slack'
 *   - settings: { workspaceName?, connected?, autoInviteEnabled?, autoInviteChannelId?, autoInviteChannelName? }
 *     (botToken is writeOnly: never sent here; the host keeps it when a save leaves it out)
 *   - onSave: (next) => Promise<void>
 */

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authenticatedFetch } from '../../../client/js/auth.js';

async function postSlackTest(botToken) {
  const res = await authenticatedFetch('/v1/plugins/slack/admin/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ botToken }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export default function SlackSettingsPanel({ settings, onSave }) {
  const [token, setToken] = useState('');
  const [workspaceName, setWorkspaceName] = useState(settings?.workspaceName || '');
  const [connected, setConnected] = useState(!!settings?.connected);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  async function handleTest() {
    if (!token.trim()) return;
    setTesting(true);
    setMessage(null);
    try {
      const data = await postSlackTest(token.trim());
      if (data.ok) {
        setWorkspaceName(data.team);
        setMessage({ text: `Connected to ${data.team}`, type: 'success' });
      } else {
        setMessage({ text: 'Connection failed', type: 'error' });
      }
    } catch (e) {
      setMessage({ text: e.message, type: 'error' });
    } finally {
      setTesting(false);
    }
  }

  async function handleConnect() {
    if (!workspaceName) {
      setMessage({ text: 'Test the connection first', type: 'error' });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await onSave({ ...settings, botToken: token.trim(), workspaceName, connected: true });
      setConnected(true);
      setToken('');
      setMessage({ text: 'Slack integration saved.', type: 'success' });
    } catch (e) {
      setMessage({ text: e.message, type: 'error' });
    } finally {
      setSaving(false);
    }
  }

  async function handleDisconnect() {
    setSaving(true);
    try {
      await onSave({ botToken: null, workspaceName: null, connected: false });
      setConnected(false);
      setWorkspaceName('');
      setToken('');
      setMessage({ text: 'Slack disconnected.', type: 'success' });
    } catch (e) {
      setMessage({ text: e.message, type: 'error' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {connected ? (
        <>
          <div className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
            <span className="text-sm">
              Connected to <strong>{workspaceName}</strong>
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            Slack invites are available in the Invite Users dialog on the Users page.
          </p>
          <Button variant="outline" onClick={handleDisconnect} disabled={saving}>
            {saving ? 'Disconnecting…' : 'Disconnect'}
          </Button>
          <AutoInvite settings={settings} onSave={onSave} />
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Connect your Slack workspace to invite users via DM. Create a Slack app at{' '}
            <a href="https://api.slack.com/apps" target="_blank" rel="noopener noreferrer" className="underline">api.slack.com/apps</a>,
            install it to your workspace, and paste the Bot User OAuth Token below.
          </p>
          <div className="space-y-2">
            <Label htmlFor="slack-token">Bot User OAuth Token</Label>
            <div className="flex gap-2">
              <Input
                id="slack-token"
                type="password"
                placeholder="xoxb-..."
                value={token}
                onChange={(e) => setToken(e.target.value)}
                className="flex-1 font-mono"
              />
              <Button variant="outline" onClick={handleTest} disabled={testing || !token.trim()}>
                {testing ? 'Testing…' : 'Test Connection'}
              </Button>
            </div>
          </div>
          {workspaceName && (
            <Button onClick={handleConnect} disabled={saving}>
              {saving ? 'Saving…' : `Connect to ${workspaceName}`}
            </Button>
          )}
        </>
      )}
      {message && (
        <span
          role="status"
          aria-live="polite"
          className={`text-sm ${message.type === 'error' ? 'text-destructive' : 'text-green-700'}`}
        >
          {message.text}
        </span>
      )}
    </div>
  );
}

async function slackApi(method, path, body) {
  const res = await authenticatedFetch(`/v1/plugins/slack/admin/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const STATUS_TEXT = { invited: 'Added', not_in_workspace: 'Not in the workspace', failed: 'Failed' };

// Auto-invite (#379): add each new plato account to a channel, if the person
// is already in the workspace (matched by email). Results and retries below.
function AutoInvite({ settings, onSave }) {
  const [enabled, setEnabled] = useState(!!settings?.autoInviteEnabled);
  const [channelId, setChannelId] = useState(settings?.autoInviteChannelId || '');
  const [channels, setChannels] = useState(null);
  const [results, setResults] = useState([]);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  const loadResults = () => slackApi('GET', 'auto-invite').then((d) => setResults(d.results || [])).catch(() => {});
  useEffect(() => {
    let cancelled = false;
    slackApi('GET', 'channels').then((list) => { if (!cancelled) setChannels(list); }).catch(() => { if (!cancelled) setChannels([]); });
    slackApi('GET', 'auto-invite').then((d) => { if (!cancelled) setResults(d.results || []); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  async function save() {
    setBusy(true);
    try {
      const channel = (channels || []).find((ch) => ch.id === channelId);
      await onSave({ ...settings, autoInviteEnabled: enabled, autoInviteChannelId: channelId || null, autoInviteChannelName: channel?.name || null });
      setStatus(enabled ? `New accounts will be added to #${channel?.name || 'the channel'}.` : 'Auto-invite is off.');
    } catch (e) { setStatus(e.message); } finally { setBusy(false); }
  }

  async function retry(body, label) {
    setBusy(true);
    try {
      const r = await slackApi('POST', 'auto-invite/retry', body);
      setStatus(`${label}: ${r.invited} added, ${r.not_in_workspace} not in the workspace, ${r.failed} failed.`);
      await loadResults();
    } catch (e) { setStatus(e.message); } finally { setBusy(false); }
  }

  const pending = results.filter((r) => r.status !== 'invited').length;
  return (
    <section className="space-y-3 border-t pt-4" aria-labelledby="slack-auto-invite">
      <h3 id="slack-auto-invite" className="text-sm font-medium">Add new accounts to a channel</h3>
      <p className="text-sm text-muted-foreground">
        When someone creates a plato account, add them to a channel if they&rsquo;re already in this Slack workspace (matched by email).
        The app needs the <code>users:read.email</code> and <code>channels:manage</code> (or <code>groups:write</code> for a private channel) scopes, and must be in the channel.
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="h-4 w-4" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        Add new accounts to a channel
      </label>
      <div className="space-y-1">
        <Label htmlFor="slack-auto-channel">Channel</Label>
        <select id="slack-auto-channel" value={channelId} onChange={(e) => setChannelId(e.target.value)} disabled={!channels}
          className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm">
          <option value="">{channels ? 'Choose a channel' : 'Loading channels…'}</option>
          {(channels || []).map((ch) => <option key={ch.id} value={ch.id}>#{ch.name}</option>)}
        </select>
      </div>
      <Button onClick={save} disabled={busy || (enabled && !channelId)}>Save</Button>
      {results.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-sm font-medium">Recent results</h4>
            {pending > 0 && <Button size="sm" variant="outline" disabled={busy} onClick={() => retry({ all: true }, 'Retried')}>Retry everyone not added ({pending})</Button>}
          </div>
          <ul className="max-h-60 space-y-1 overflow-y-auto text-sm" aria-label="Auto-invite results">
            {results.map((r) => (
              <li key={r.userId} className="flex items-center gap-2">
                <span className="flex-1 truncate">{r.name} <span className="text-muted-foreground">{r.email}</span></span>
                <span className={r.status === 'invited' ? 'text-green-700' : r.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'} title={r.error || undefined}>
                  {STATUS_TEXT[r.status] || r.status}{r.error ? ` (${r.error})` : ''}
                </span>
                {r.status !== 'invited' && (
                  <Button size="xs" variant="ghost" disabled={busy} aria-label={`Retry ${r.name}`} onClick={() => retry({ userId: r.userId }, `Retried ${r.name}`)}>Retry</Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-sm text-muted-foreground" role="status" aria-live="polite">{status}</p>
    </section>
  );
}
