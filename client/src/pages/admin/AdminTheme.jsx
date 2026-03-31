import { useState, useEffect } from 'react';
import { adminApi } from './adminApi.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const THEME_VARS = [
  { key: 'headerBg', label: 'Header Background', default: '#470d99' },
  { key: 'headerText', label: 'Header Text', default: '#ffffff' },
  { key: 'accent', label: 'Accent / Links', default: '#470d99' },
  { key: 'background', label: 'Page Background', default: '#ffffff' },
  { key: 'surface', label: 'Surface / Cards', default: '#f5f5f5' },
  { key: 'text', label: 'Text', default: '#1a1a1a' },
  { key: 'border', label: 'Borders', default: '#e0e0e0' },
];

export default function AdminTheme() {
  const [theme, setTheme] = useState({});
  const [logoBase64, setLogoBase64] = useState(null);
  const [logoAlt, setLogoAlt] = useState('');
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.title = 'Classroom Theme — plato';
    loadTheme();
  }, []);

  async function loadTheme() {
    setLoading(true);
    try {
      const data = await adminApi('GET', '/v1/admin/theme');
      setTheme(data.theme || {});
      setLogoBase64(data.logoBase64 || null);
      setLogoAlt(data.logoAlt || '');
    } catch { /* ignore */ }
    setLoading(false);
  }

  function updateVar(key, value) {
    setTheme(prev => ({ ...prev, [key]: value }));
  }

  async function saveTheme() {
    try {
      await adminApi('PUT', '/v1/admin/theme', { theme, logoBase64, logoAlt });
      setMessage({ text: 'Classroom theme saved. Learners will see the changes on next load.', type: 'success' });
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
      <h1 className="text-2xl font-bold mb-1">Classroom Theme & Branding</h1>
      <p className="text-sm text-muted-foreground mb-4">These settings only affect the learner-facing classroom. The plato dashboard always uses the default plato branding.</p>

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
          <CardTitle>Classroom Colors</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {THEME_VARS.map(v => (
              <div key={v.key} className="flex items-center gap-3">
                <input
                  type="color"
                  value={theme[v.key] || v.default}
                  onChange={e => updateVar(v.key, e.target.value)}
                  className="w-10 h-10 rounded border border-border cursor-pointer p-0.5"
                  aria-label={v.label}
                />
                <div>
                  <Label className="text-sm">{v.label}</Label>
                  <code className="block text-xs text-muted-foreground">{theme[v.key] || v.default}</code>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Classroom Logo</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">This logo appears in the classroom header. If not set, the plato logo is used.</p>
          <div className="space-y-2">
            <Label htmlFor="logo-alt">Logo alt text</Label>
            <Input id="logo-alt" type="text" value={logoAlt} placeholder="Your organization name"
              onChange={e => setLogoAlt(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="logo-file">Upload logo</Label>
            <Input id="logo-file" type="file" accept="image/*" onChange={handleLogoUpload} />
          </div>
          {logoBase64 && (
            <div className="p-4 bg-muted rounded-lg text-center">
              <img src={logoBase64} alt={logoAlt || 'Logo preview'} className="max-h-16 inline-block" />
            </div>
          )}
        </CardContent>
      </Card>

      <Button onClick={saveTheme}>Save Classroom Theme</Button>
    </div>
  );
}
