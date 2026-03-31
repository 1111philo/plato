import { useState, useEffect } from 'react';
import { adminApi } from './adminApi.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

export default function AdminSettings() {
  // Style state
  const [primary, setPrimary] = useState('#8b1a1a');
  const [accent, setAccent] = useState('#dc2626');
  const [logoBase64, setLogoBase64] = useState(null);
  const [logoAlt, setLogoAlt] = useState('');
  const [logoError, setLogoError] = useState('');
  const [styleSaving, setStyleSaving] = useState(false);
  const [styleMessage, setStyleMessage] = useState(null);

  // Danger zone state
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetInput, setResetInput] = useState('');
  const [dangerMessage, setDangerMessage] = useState(null);

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.title = 'Settings — plato';
    loadAll();
  }, []);

  async function loadAll() {
    setLoading(true);
    try {
      const data = await adminApi('GET', '/v1/admin/theme');
      const t = data.theme || {};
      setPrimary(t.primary || '#8b1a1a');
      setAccent(t.accent || '#dc2626');
      setLogoBase64(data.logoBase64 || null);
      setLogoAlt(data.logoAlt || '');
    } catch { /* ignore */ }
    setLoading(false);
  }

  async function saveStyle() {
    setStyleSaving(true);
    setStyleMessage(null);
    try {
      await adminApi('PUT', '/v1/admin/theme', { theme: { primary, accent }, logoBase64, logoAlt });
      setStyleMessage({ text: 'Saved! Click "Visit Classroom" to see changes.', type: 'success' });
    } catch (e) { setStyleMessage({ text: e.message, type: 'error' }); }
    finally { setStyleSaving(false); }
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
          setLogoError('Image must be at least 512×512px for crisp rendering at all sizes.');
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

  async function resetAllSyncData() {
    if (resetInput !== 'RESET') return;
    try {
      const data = await adminApi('DELETE', '/v1/admin/sync');
      setDangerMessage({ text: `Sync data reset: ${data.itemsDeleted} items deleted across ${data.usersAffected} users.`, type: 'success' });
      setShowResetConfirm(false);
      setResetInput('');
    } catch (e) { setDangerMessage({ text: e.message, type: 'error' }); }
  }

  if (loading) return <div className="flex items-center justify-center py-12 text-muted-foreground" role="status" aria-live="polite">Loading...</div>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Settings</h1>

      <Tabs defaultValue="style" className="space-y-4">
        <TabsList>
          <TabsTrigger value="style">Classroom Style</TabsTrigger>
          <TabsTrigger value="danger">Danger Zone</TabsTrigger>
        </TabsList>

        <TabsContent value="style">
          <p className="text-sm text-muted-foreground mb-4">These settings only affect the learner-facing classroom. The plato dashboard always uses the default plato branding.</p>

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

          <div className="flex items-center gap-3">
            <Button onClick={saveStyle} disabled={styleSaving}>{styleSaving ? 'Saving...' : 'Save Classroom Style'}</Button>
            {styleMessage && <span role="status" aria-live="polite" className={`text-sm ${styleMessage.type === 'error' ? 'text-destructive' : 'text-green-700'}`}>{styleMessage.text}</span>}
          </div>
        </TabsContent>

        <TabsContent value="danger">
          <Card className="border-destructive/30">
            <CardHeader><CardTitle className="text-destructive">Danger Zone</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {dangerMessage && (
                <div className={`rounded-lg px-4 py-3 text-sm ${dangerMessage.type === 'error' ? 'bg-destructive/10 text-destructive' : 'bg-green-50 text-green-800'}`} role="alert">
                  {dangerMessage.text}
                </div>
              )}
              <p className="text-sm text-muted-foreground">Reset synced data for all users. This cannot be undone.</p>
              {!showResetConfirm ? (
                <Button variant="destructive" onClick={() => setShowResetConfirm(true)}>Reset all sync data</Button>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="reset-confirm" className="text-amber-600">Type RESET to confirm</Label>
                  <div className="flex gap-2">
                    <Input id="reset-confirm" value={resetInput} onChange={e => setResetInput(e.target.value)}
                      placeholder="RESET" className="flex-1"
                      onKeyDown={e => {
                        if (e.key === 'Enter' && resetInput === 'RESET') resetAllSyncData();
                        if (e.key === 'Escape') { setShowResetConfirm(false); setResetInput(''); }
                      }} />
                    <Button variant="destructive" disabled={resetInput !== 'RESET'} onClick={resetAllSyncData}>Reset</Button>
                    <Button variant="outline" onClick={() => { setShowResetConfirm(false); setResetInput(''); }}>Cancel</Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
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
