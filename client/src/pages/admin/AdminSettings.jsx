import { useState, useEffect } from 'react';
import { adminApi } from './adminApi.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function AdminSettings() {
  const [primary, setPrimary] = useState('#8b1a1a');
  const [accent, setAccent] = useState('#dc2626');
  const [logoBase64, setLogoBase64] = useState(null);
  const [logoAlt, setLogoAlt] = useState('');
  const [logoError, setLogoError] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(true);

  // Slack integration state
  const [slackToken, setSlackToken] = useState('');
  const [slackConnected, setSlackConnected] = useState(false);
  const [slackWorkspace, setSlackWorkspace] = useState('');
  const [slackTesting, setSlackTesting] = useState(false);
  const [slackSaving, setSlackSaving] = useState(false);
  const [slackMessage, setSlackMessage] = useState(null);

  useEffect(() => {
    document.title = 'Settings — plato';
    loadAll();
  }, []);

  async function loadAll() {
    setLoading(true);
    try {
      const [themeData, settingsData] = await Promise.all([
        adminApi('GET', '/v1/admin/theme'),
        adminApi('GET', '/v1/admin/settings'),
      ]);
      const t = themeData.theme || {};
      setPrimary(t.primary || '#8b1a1a');
      setAccent(t.accent || '#dc2626');
      setLogoBase64(themeData.logoBase64 || null);
      setLogoAlt(themeData.logoAlt || '');
      // Slack
      const slack = settingsData.slack || {};
      if (slack.connected && slack.workspaceName) {
        setSlackConnected(true);
        setSlackWorkspace(slack.workspaceName);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }

  async function saveStyle() {
    setSaving(true);
    setMessage(null);
    try {
      await adminApi('PUT', '/v1/admin/theme', { theme: { primary, accent }, logoBase64, logoAlt });
      setMessage({ text: 'Saved! Click "Visit Classroom" to see changes.', type: 'success' });
    } catch (e) { setMessage({ text: e.message, type: 'error' }); }
    finally { setSaving(false); }
  }

  function handleLogoUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    setLogoError('');
    if (file.type === 'image/svg+xml') {
      const reader = new FileReader();
      reader.onload = (ev) => setLogoBase64(ev.target.result);
      reader.readAsDataURL(file);
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        if (img.width < 512 || img.height < 512) {
          setLogoError('Image must be at least 512×512px.');
          return;
        }
        const size = 512;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        const scale = Math.min(size / img.width, size / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        setLogoBase64(canvas.toDataURL('image/png'));
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
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
      <h1 className="text-2xl font-bold mb-1">Settings</h1>
      <p className="text-sm text-muted-foreground mb-4">Classroom style and branding. These settings only affect the learner-facing classroom.</p>

      <Card className="mb-6">
        <CardHeader><CardTitle>Colors</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">Set two colors — contrast is derived automatically.</p>
          <div className="flex flex-wrap gap-6">
            <div className="flex items-center gap-3">
              <input type="color" value={primary} onChange={e => setPrimary(e.target.value)}
                className="w-12 h-12 rounded-lg border border-border cursor-pointer p-0.5" aria-label="Primary color" />
              <div>
                <Label>Primary</Label>
                <p className="text-xs text-muted-foreground">Header, buttons, badges</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <input type="color" value={accent} onChange={e => setAccent(e.target.value)}
                className="w-12 h-12 rounded-lg border border-border cursor-pointer p-0.5" aria-label="Accent color" />
              <div>
                <Label>Accent</Label>
                <p className="text-xs text-muted-foreground">Links, focus rings</p>
              </div>
            </div>
          </div>
          <div className="rounded-lg overflow-hidden border border-border" aria-label="Theme preview">
            <div className="px-4 py-2 flex items-center gap-2 text-sm" style={{ backgroundColor: primary, color: lum(primary) < 0.4 ? '#fff' : '#1a1a1a' }}>
              <span className="font-semibold">Header Preview</span>
              <span className="ml-auto opacity-80">Nav Item</span>
            </div>
            <div className="px-4 py-3 bg-background text-sm space-y-2">
              <p>Body text on white background.</p>
              <a href="#" onClick={e => e.preventDefault()} style={{ color: accent }} className="underline">Accent link</a>
              <div className="flex gap-2 mt-2">
                <span className="px-2 py-0.5 rounded text-xs font-medium" style={{ backgroundColor: primary, color: lum(primary) < 0.4 ? '#fff' : '#1a1a1a' }}>Badge</span>
                <span className="px-2 py-0.5 rounded text-xs font-medium border" style={{ borderColor: accent, color: accent }}>Outline</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader><CardTitle>Classroom Logo</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">Appears in the classroom header and favicon. If not set, the plato logo is used.</p>
          <p className="text-xs text-muted-foreground">Square, at least 512×512px. SVG preferred.</p>
          <div className="space-y-2">
            <Label htmlFor="logo-alt">Logo alt text</Label>
            <Input id="logo-alt" type="text" value={logoAlt} placeholder="Your organization name" onChange={e => setLogoAlt(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="logo-file">Upload logo</Label>
            <Input id="logo-file" type="file" accept="image/svg+xml,image/png,image/jpeg,image/webp" onChange={handleLogoUpload} />
            {logoError && <p className="text-sm text-destructive">{logoError}</p>}
          </div>
          {logoBase64 && (
            <div className="p-4 rounded-lg text-center" style={{ backgroundColor: primary }}>
              <img src={logoBase64} alt={logoAlt || 'Logo preview'} className="max-h-12 inline-block" />
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center gap-3 mb-6">
        <Button onClick={saveStyle} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button>
        {message && <span role="status" aria-live="polite" className={`text-sm ${message.type === 'error' ? 'text-destructive' : 'text-green-700'}`}>{message.text}</span>}
      </div>

      <h2 className="text-xl font-bold mb-1">Integrations</h2>
      <p className="text-sm text-muted-foreground mb-4">Connect external services to extend plato's functionality.</p>

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

function lum(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const lin = (c) => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
