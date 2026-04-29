/**
 * Slack settings panel — rendered as the `adminSettingsPanel` slot inside the
 * Integrations card on /plato/integrations.
 *
 * Props (per the SettingsPanel slot contract):
 *   - pluginId: 'slack'
 *   - settings: { botToken?: string, workspaceName?: string, connected?: boolean }
 *   - onSave: (next) => Promise<void>
 */

import { useState } from 'react';
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
      await onSave({ botToken: token.trim(), workspaceName, connected: true });
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
