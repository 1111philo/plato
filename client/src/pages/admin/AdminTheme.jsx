import { useState, useEffect } from 'react';
import { adminApi } from './adminApi.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function AdminTheme() {
  const [primary, setPrimary] = useState('#470d99');
  const [accent, setAccent] = useState('#470d99');
  const [logoBase64, setLogoBase64] = useState(null);
  const [logoAlt, setLogoAlt] = useState('');
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    document.title = 'Classroom Theme — plato';
    loadTheme();
  }, []);

  async function loadTheme() {
    setLoading(true);
    try {
      const data = await adminApi('GET', '/v1/admin/theme');
      const t = data.theme || {};
      setPrimary(t.primary || '#470d99');
      setAccent(t.accent || '#470d99');
      setLogoBase64(data.logoBase64 || null);
      setLogoAlt(data.logoAlt || '');
    } catch { /* ignore */ }
    setLoading(false);
  }

  async function saveTheme() {
    setSaving(true);
    setMessage(null);
    try {
      await adminApi('PUT', '/v1/admin/theme', {
        theme: { primary, accent },
        logoBase64,
        logoAlt,
      });
      setMessage({ text: 'Saved! Click "Visit Classroom" to see the changes.', type: 'success' });
    } catch (e) {
      setMessage({ text: e.message, type: 'error' });
    } finally {
      setSaving(false);
    }
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

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Colors</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">Set two colors — text, backgrounds, and contrast are derived automatically.</p>
          <div className="flex flex-wrap gap-6">
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={primary}
                onChange={e => setPrimary(e.target.value)}
                className="w-12 h-12 rounded-lg border border-border cursor-pointer p-0.5"
                aria-label="Primary color"
              />
              <div>
                <Label>Primary</Label>
                <p className="text-xs text-muted-foreground">Header, buttons, badges</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={accent}
                onChange={e => setAccent(e.target.value)}
                className="w-12 h-12 rounded-lg border border-border cursor-pointer p-0.5"
                aria-label="Accent color"
              />
              <div>
                <Label>Accent</Label>
                <p className="text-xs text-muted-foreground">Links, focus rings, highlights</p>
              </div>
            </div>
          </div>

          {/* Live preview */}
          <div className="rounded-lg overflow-hidden border border-border">
            <div className="px-4 py-2 flex items-center gap-2 text-sm" style={{ backgroundColor: primary, color: luminance(primary) < 0.5 ? '#fff' : '#1a1a1a' }}>
              <span className="font-semibold">Header Preview</span>
              <span className="ml-auto opacity-80">Nav Item</span>
            </div>
            <div className="px-4 py-3 bg-background text-sm space-y-2">
              <p>Body text on white background.</p>
              <a href="#" onClick={e => e.preventDefault()} style={{ color: accent }} className="underline">Accent link</a>
              <div className="flex gap-2 mt-2">
                <span className="px-2 py-0.5 rounded text-xs font-medium" style={{ backgroundColor: primary, color: luminance(primary) < 0.5 ? '#fff' : '#1a1a1a' }}>Badge</span>
                <span className="px-2 py-0.5 rounded text-xs font-medium border" style={{ borderColor: accent, color: accent }}>Outline</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Classroom Logo</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">Appears in the classroom header and favicon. If not set, the plato logo is used.</p>
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
            <div className="p-4 rounded-lg text-center" style={{ backgroundColor: primary }}>
              <img src={logoBase64} alt={logoAlt || 'Logo preview'} className="max-h-12 inline-block" />
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button onClick={saveTheme} disabled={saving}>
          {saving ? 'Saving...' : 'Save Classroom Theme'}
        </Button>
        {message && (
          <span className={`text-sm ${message.type === 'error' ? 'text-destructive' : 'text-green-700'}`}>
            {message.text}
          </span>
        )}
      </div>
    </div>
  );
}

/** Relative luminance of a hex color (0 = black, 1 = white). */
function luminance(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const lin = (c) => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
