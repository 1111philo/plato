import { useState, useEffect } from 'react';
import { adminApi } from './adminApi.js';

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

  if (loading) return <div className="admin-loading">Loading...</div>;

  return (
    <div>
      <h1>Theme & Branding</h1>
      {message && (
        <div className={`admin-alert admin-alert-${message.type}`} role="alert">
          {message.text}
          <button onClick={() => setMessage(null)} aria-label="Dismiss">&times;</button>
        </div>
      )}

      <div className="admin-card">
        <h2>Colors</h2>
        <p className="admin-subtitle">Changes preview live. Click Save to persist.</p>
        <div className="admin-theme-grid">
          {THEME_VARS.map(v => (
            <div key={v.key} className="admin-theme-row">
              <label htmlFor={`theme-${v.key}`}>{v.label}</label>
              <input id={`theme-${v.key}`} type="color"
                value={theme[v.key] || v.default}
                onChange={e => updateVar(v.key, e.target.value)} />
              <code>{v.key}</code>
            </div>
          ))}
        </div>
      </div>

      <div className="admin-card">
        <h2>Logo</h2>
        <div className="form-group">
          <label htmlFor="logo-alt">Logo alt text</label>
          <input id="logo-alt" type="text" value={logoAlt}
            onChange={e => setLogoAlt(e.target.value)} />
        </div>
        <div className="form-group">
          <label htmlFor="logo-file">Upload logo</label>
          <input id="logo-file" type="file" accept="image/*" onChange={handleLogoUpload} />
        </div>
        {logoBase64 && (
          <div className="admin-logo-preview">
            <img src={logoBase64} alt={logoAlt} style={{ maxHeight: 64 }} />
          </div>
        )}
      </div>

      <button className="primary-btn" onClick={saveTheme}>Save Theme</button>
    </div>
  );
}
