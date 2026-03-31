import { useState, useEffect } from 'react';
import { adminApi } from './adminApi.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const THEME_VARS = [
  { key: '--color-bg', label: 'Background', default: '#ffffff' },
  { key: '--color-surface', label: 'Surface', default: '#f5f5f5' },
  { key: '--color-border', label: 'Border', default: '#e0e0e0' },
  { key: '--color-text', label: 'Text', default: '#1a1a1a' },
  { key: '--color-text-secondary', label: 'Text Secondary', default: '#555555' },
  { key: '--color-primary', label: 'Primary (Header)', default: '#1a1a1a' },
  { key: '--color-primary-text', label: 'Primary Text', default: '#ffffff' },
  { key: '--color-accent', label: 'Accent', default: '#2563eb' },
  { key: '--color-success', label: 'Success', default: '#16a34a' },
  { key: '--color-warning', label: 'Warning', default: '#d97706' },
];

export default function AdminTheme() {
  const [theme, setTheme] = useState({});
  const [logoBase64, setLogoBase64] = useState(null);
  const [logoAlt, setLogoAlt] = useState('plato');
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.title = 'Theme — Admin';
    loadTheme();
  }, []);

  async function loadTheme() {
    setLoading(true);
    try {
      const data = await adminApi('GET', '/v1/admin/theme');
      setTheme(data.theme || {});
      setLogoBase64(data.logoBase64 || null);
      setLogoAlt(data.logoAlt || 'plato');
    } catch { /* ignore */ }
    setLoading(false);
  }

  function updateVar(key, value) {
    setTheme(prev => ({ ...prev, [key]: value }));
    document.documentElement.style.setProperty(key, value);
  }

  async function saveTheme() {
    try {
      await adminApi('PUT', '/v1/admin/theme', { theme, logoBase64, logoAlt });
      setMessage({ text: 'Theme saved.', type: 'success' });
    } catch (e) { setMessage({ text: e.message, type: 'error' }); }
  }

  function handleLogoUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setLogoBase64(ev.target.result);
    reader.readAsDataURL(file);
  }

  if (loading) return <div className="flex items-center justify-center py-12 text-muted-foreground">Loading...</div>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Theme & Branding</h1>

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
          <button onClick={() => setMessage(null)} aria-label="Dismiss" className="ml-2 text-lg leading-none hover:opacity-70">&times;</button>
        </div>
      )}

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Colors</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">Changes preview live. Click Save to persist.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {THEME_VARS.map(v => (
              <div key={v.key} className="flex items-center gap-3">
                <Label htmlFor={`theme-${v.key}`} className="min-w-28 text-sm">{v.label}</Label>
                <input
                  id={`theme-${v.key}`}
                  type="color"
                  className="h-8 w-10 cursor-pointer rounded border border-border"
                  value={theme[v.key] || v.default}
                  onChange={e => updateVar(v.key, e.target.value)}
                />
                <code className="text-xs text-muted-foreground">{v.key}</code>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Logo</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="logo-alt">Logo alt text</Label>
            <Input id="logo-alt" type="text" value={logoAlt} onChange={e => setLogoAlt(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="logo-file">Upload logo</Label>
            <Input id="logo-file" type="file" accept="image/*" onChange={handleLogoUpload} />
          </div>
          {logoBase64 && (
            <div className="pt-2">
              <img src={logoBase64} alt={logoAlt} className="max-h-16" />
            </div>
          )}
        </CardContent>
      </Card>

      <Button onClick={saveTheme}>Save Theme</Button>
    </div>
  );
}
