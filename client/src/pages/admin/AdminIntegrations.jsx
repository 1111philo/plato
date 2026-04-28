import { useState, useEffect } from 'react';
import { adminApi } from './adminApi.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function AdminIntegrations() {
  const [slackToken, setSlackToken] = useState('');
  const [slackConnected, setSlackConnected] = useState(false);
  const [slackWorkspace, setSlackWorkspace] = useState('');
  const [slackTesting, setSlackTesting] = useState(false);
  const [slackSaving, setSlackSaving] = useState(false);
  const [slackMessage, setSlackMessage] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.title = 'Integrations — plato';
    loadSettings();
  }, []);

  async function loadSettings() {
    setLoading(true);
    try {
      const data = await adminApi('GET', '/v1/admin/settings');
      const slack = data.slack || {};
      if (slack.connected && slack.workspaceName) {
        setSlackConnected(true);
        setSlackWorkspace(slack.workspaceName);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }

  async function testSlackConnection() {
    if (!slackToken.trim()) return;
    setSlackTesting(true);
    setSlackMessage(null);
    try {
      const data = await adminApi('POST', '/v1/admin/slack/test', { botToken: slackToken.trim() });
      if (data.ok) {
        setSlackWorkspace(data.team);
        setSlackMessage({ text: `Connected to ${data.team}`, type: 'success' });
      } else {
        setSlackMessage({ text: 'Connection failed', type: 'error' });
      }
    } catch (e) {
      setSlackMessage({ text: e.message, type: 'error' });
    } finally {
      setSlackTesting(false);
    }
  }

  async function saveSlackIntegration() {
    if (!slackWorkspace) {
      setSlackMessage({ text: 'Test the connection first', type: 'error' });
      return;
    }
    setSlackSaving(true);
    setSlackMessage(null);
    try {
      await adminApi('PUT', '/v1/admin/settings', {
        slack: { botToken: slackToken.trim(), workspaceName: slackWorkspace, connected: true },
      });
      setSlackConnected(true);
      setSlackMessage({ text: 'Slack integration saved.', type: 'success' });
    } catch (e) {
      setSlackMessage({ text: e.message, type: 'error' });
    } finally {
      setSlackSaving(false);
    }
  }

  async function disconnectSlack() {
    setSlackSaving(true);
    try {
      await adminApi('PUT', '/v1/admin/settings', {
        slack: { botToken: null, workspaceName: null, connected: false },
      });
      setSlackConnected(false);
      setSlackWorkspace('');
      setSlackToken('');
      setSlackMessage({ text: 'Slack disconnected.', type: 'success' });
    } catch (e) {
      setSlackMessage({ text: e.message, type: 'error' });
    } finally {
      setSlackSaving(false);
    }
  }

  if (loading) return <div className="flex items-center justify-center py-12 text-muted-foreground" role="status" aria-live="polite">Loading...</div>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Integrations</h1>
      <p className="text-sm text-muted-foreground mb-4">Connect external services to extend plato&apos;s functionality.</p>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zm-1.27 0a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.163 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.163 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.163 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zm0-1.27a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.315A2.528 2.528 0 0 1 24 15.163a2.528 2.528 0 0 1-2.522 2.523h-6.315z" fill="currentColor"/>
            </svg>
            Slack
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {slackConnected ? (
            <>
              <div className="flex items-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
                <span className="text-sm">Connected to <strong>{slackWorkspace}</strong></span>
              </div>
              <p className="text-sm text-muted-foreground">
                Slack invites are available in the Invite Users dialog on the Users page.
              </p>
              <Button variant="outline" onClick={disconnectSlack} disabled={slackSaving}>
                {slackSaving ? 'Disconnecting...' : 'Disconnect'}
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
                    value={slackToken}
                    onChange={e => setSlackToken(e.target.value)}
                    className="flex-1 font-mono"
                  />
                  <Button variant="outline" onClick={testSlackConnection} disabled={slackTesting || !slackToken.trim()}>
                    {slackTesting ? 'Testing...' : 'Test Connection'}
                  </Button>
                </div>
              </div>
              {slackWorkspace && !slackConnected && (
                <Button onClick={saveSlackIntegration} disabled={slackSaving}>
                  {slackSaving ? 'Saving...' : `Connect to ${slackWorkspace}`}
                </Button>
              )}
            </>
          )}
          {slackMessage && (
            <span role="status" aria-live="polite" className={`text-sm ${slackMessage.type === 'error' ? 'text-destructive' : 'text-green-700'}`}>
              {slackMessage.text}
            </span>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
