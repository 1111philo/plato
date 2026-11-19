/**
 * Microsoft Entra SSO settings panel: the `adminSettingsPanel` slot inside
 * the plugin card on /plato/plugins.
 *
 * Props (per the SettingsPanel slot contract):
 *   - pluginId: 'entra-sso'
 *   - settings: { buttonLabel?, buttonBackground?, buttonTextColor?, buttonIcon? }
 *   - onSave: (next) => Promise<void>
 *
 * The only things saved here are how the sign-in button looks: its label, an
 * icon, and a background / text color pair (docs/SSO.md, "Button style"; the
 * server validates all of it again). The tenant, client id, secret, and owned
 * domains are deployment config: this panel shows them (masked, from the
 * admin status route) and never edits them.
 */

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import SsoButton from '@/components/SsoButton';
import { checkSsoColors, isHexColor, SSO_ICON_PIXELS } from '@/lib/sso.js';
import { authenticatedFetch } from '../../../client/js/auth.js';
import { fileToIcon } from './icon.js';

const DEFAULT_LABEL = 'Sign in with Microsoft';
const MAX_LABEL = 40;
const DOCS_URL = 'https://github.com/1111philo/plato/blob/main/docs/SSO.md';

async function fetchStatus() {
  const res = await authenticatedFetch('/v1/plugins/entra-sso/admin/status');
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// A hex field with the browser's color picker beside it. The text field is
// the labelled control; the picker is a second way to set the same value.
function ColorField({ id, label, value, onChange, invalid, placeholder }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} picker`}
          value={isHexColor(value.trim()) ? value.trim().toLowerCase() : '#ffffff'}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 w-10 shrink-0 cursor-pointer rounded-lg border border-border p-0.5 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        <Input
          id={id}
          value={value}
          maxLength={7}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={invalid || undefined}
          aria-describedby="entra-button-colors-help"
          className="w-28 font-mono"
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </div>
  );
}

export default function EntraSettingsPanel({ settings, onSave }) {
  const [status, setStatus] = useState(null); // null = loading
  const [statusError, setStatusError] = useState('');
  const [label, setLabel] = useState(settings?.buttonLabel || '');
  const [background, setBackground] = useState(settings?.buttonBackground || '');
  const [textColor, setTextColor] = useState(settings?.buttonTextColor || '');
  const [icon, setIcon] = useState(settings?.buttonIcon || '');
  const [iconError, setIconError] = useState('');
  const fileRef = useRef(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [copied, setCopied] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetchStatus()
      .then((s) => { if (!cancelled) setStatus(s); })
      .catch((e) => { if (!cancelled) setStatusError(e.message); });
    return () => { cancelled = true; };
  }, []);

  async function copyRedirect() {
    try {
      await navigator.clipboard.writeText(status.redirectUri);
      setCopied('Redirect URI copied.');
    } catch {
      setCopied('Couldn’t copy. Select the address and copy it.');
    }
  }

  const colors = checkSsoColors(background, textColor);

  async function chooseIcon(e) {
    const input = e.target;
    const file = input.files?.[0];
    if (!file) return;
    setIconError('');
    try {
      setIcon(await fileToIcon(file));
    } catch (err) {
      setIconError(err.message);
      input.value = '';
    }
  }

  function removeIcon() {
    setIcon('');
    setIconError('');
    if (fileRef.current) {
      fileRef.current.value = '';
      fileRef.current.focus(); // the button that had focus is gone
    }
  }

  function resetColors() {
    setBackground('');
    setTextColor('');
    document.getElementById('entra-button-bg')?.focus(); // likewise
  }

  async function save(e) {
    e.preventDefault();
    if (!colors.ok) {
      setMessage({ text: `Not saved. ${colors.message}`, type: 'error' });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await onSave({
        ...settings,
        buttonLabel: label.trim(),
        buttonBackground: background.trim(),
        buttonTextColor: textColor.trim(),
        buttonIcon: icon,
      });
      setMessage({ text: 'Saved.', type: 'success' });
    } catch (err) {
      setMessage({ text: err.message, type: 'error' });
    } finally {
      setSaving(false);
    }
  }

  const domains = Array.isArray(status?.domains) ? status.domains : [];
  const domainText = domains.length ? domains.map((d) => `@${d}`).join(', ') : 'matching';

  return (
    <div className="space-y-5">
      <section className="space-y-2" aria-labelledby="entra-status">
        <h3 id="entra-status" className="text-sm font-medium">Deployment settings</h3>
        {statusError ? (
          <p className="text-sm text-destructive" role="alert">Couldn’t load the status: {statusError}</p>
        ) : !status ? (
          <p className="text-sm text-muted-foreground" role="status" aria-live="polite">Loading…</p>
        ) : status.configured ? (
          <>
            <p className="flex items-center gap-2 text-sm">
              <span className="inline-block h-2 w-2 rounded-full bg-green-600" aria-hidden="true" />
              <strong>Configured</strong>
            </p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Tenant ID</dt>
              <dd><code>{status.tenantId}</code></dd>
              <dt className="text-muted-foreground">Client ID</dt>
              <dd><code>{status.clientId}</code></dd>
              <dt className="text-muted-foreground">Email domains</dt>
              <dd>{domains.length ? domains.join(', ') : 'None'}</dd>
            </dl>
          </>
        ) : (
          <p className="text-sm">
            <strong>Not configured:</strong> this deployment hasn’t supplied its Entra settings, so there’s no sign-in button. See{' '}
            <a href={DOCS_URL} target="_blank" rel="noopener noreferrer" className="underline">docs/SSO.md</a>.
          </p>
        )}
        {status && (
          <div className="space-y-1">
            <Label htmlFor="entra-redirect-uri">Redirect URI</Label>
            <div className="flex gap-2">
              <Input id="entra-redirect-uri" readOnly value={status.redirectUri || ''} className="flex-1 font-mono text-xs" onFocus={(e) => e.target.select()} />
              <Button type="button" variant="outline" onClick={copyRedirect} aria-label="Copy redirect URI">Copy</Button>
            </div>
            <p className="text-sm text-muted-foreground" role="status" aria-live="polite">{copied}</p>
          </div>
        )}
        <p className="text-sm text-muted-foreground">
          These come from the deployment and can’t be changed here.
        </p>
      </section>

      <form className="space-y-4 border-t pt-4" onSubmit={save} noValidate aria-labelledby="entra-button">
        <h3 id="entra-button" className="text-sm font-medium">Sign-in button</h3>
        <div className="space-y-2">
          <Label htmlFor="entra-button-label">Button label</Label>
          <Input
            id="entra-button-label"
            value={label}
            maxLength={MAX_LABEL}
            placeholder={DEFAULT_LABEL}
            aria-describedby="entra-button-label-help"
            onChange={(e) => setLabel(e.target.value)}
          />
          <p id="entra-button-label-help" className="text-sm text-muted-foreground">
            Up to {MAX_LABEL} characters, e.g. “Sign in with UIC”. Empty uses “{DEFAULT_LABEL}”.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="entra-button-icon">Icon</Label>
          <div className="flex flex-wrap items-center gap-3">
            {icon && (
              <span className="inline-flex size-10 items-center justify-center rounded-lg border bg-background">
                <img src={icon} alt="" className="size-5 object-contain" data-testid="entra-icon-current" />
              </span>
            )}
            <Input
              id="entra-button-icon"
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              aria-describedby="entra-button-icon-help"
              className="max-w-xs flex-1"
              onChange={chooseIcon}
            />
            {icon && <Button type="button" variant="outline" onClick={removeIcon}>Remove icon</Button>}
          </div>
          <p id="entra-button-icon-help" className="text-sm text-muted-foreground">
            PNG, JPEG, or WebP. Resized to fit {SSO_ICON_PIXELS} × {SSO_ICON_PIXELS}.
          </p>
          <p className="text-sm text-destructive" role="alert">{iconError}</p>
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-end gap-4">
            <ColorField id="entra-button-bg" label="Background color" value={background} onChange={setBackground} invalid={!colors.ok} placeholder="#001E62" />
            <ColorField id="entra-button-fg" label="Text color" value={textColor} onChange={setTextColor} invalid={!colors.ok} placeholder="#FFFFFF" />
            {(background || textColor) && <Button type="button" variant="outline" onClick={resetColors}>Reset colors</Button>}
          </div>
          <p
            id="entra-button-colors-help"
            role="status"
            aria-live="polite"
            className={`text-sm ${colors.ok ? 'text-muted-foreground' : 'text-destructive'}`}
          >
            {colors.message}
          </p>
        </div>

        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">Preview</p>
          {/* The real button, not a copy of it; inert, since it goes nowhere here. */}
          <div data-testid="entra-button-preview" inert className="max-w-sm rounded-lg border bg-background p-4">
            <SsoButton
              label={label.trim() || DEFAULT_LABEL}
              style={{ background: background.trim(), color: textColor.trim(), icon }}
              tabIndex={-1}
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
          <span
            role={message?.type === 'error' ? 'alert' : 'status'}
            aria-live={message?.type === 'error' ? 'assertive' : 'polite'}
            className={`text-sm ${message?.type === 'error' ? 'text-destructive' : 'text-green-800'}`}
          >
            {message?.text}
          </span>
        </div>
      </form>

      <section className="space-y-2 border-t pt-4" aria-labelledby="entra-rules">
        <h3 id="entra-rules" className="text-sm font-medium">How it works</h3>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Invite only: signing in never creates an account without an invite.</li>
          <li>An existing account with a {domainText} email is connected automatically.</li>
          <li>Turning this plugin off removes the button at once. Password sign-in is never affected.</li>
        </ul>
      </section>
    </div>
  );
}
