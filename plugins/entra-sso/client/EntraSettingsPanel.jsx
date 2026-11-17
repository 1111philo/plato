/**
 * Microsoft Entra SSO settings panel: the `adminSettingsPanel` slot inside
 * the plugin card on /plato/plugins.
 *
 * Props (per the SettingsPanel slot contract):
 *   - pluginId: 'entra-sso'
 *   - settings: { buttonLabel? }
 *   - onSave: (next) => Promise<void>
 *
 * The only thing saved here is the button label. The tenant, client id,
 * secret, and owned domains are deployment config (docs/SSO.md): this panel
 * shows them (masked, from the admin status route) and never edits them.
 */

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authenticatedFetch } from '../../../client/js/auth.js';

const DEFAULT_LABEL = 'Sign in with Microsoft';
const MAX_LABEL = 40;
const DOCS_URL = 'https://github.com/1111philo/plato/blob/main/docs/SSO.md';

async function fetchStatus() {
  const res = await authenticatedFetch('/v1/plugins/entra-sso/admin/status');
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export default function EntraSettingsPanel({ settings, onSave }) {
  const [status, setStatus] = useState(null); // null = loading
  const [statusError, setStatusError] = useState('');
  const [label, setLabel] = useState(settings?.buttonLabel || '');
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

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      await onSave({ ...settings, buttonLabel: label.trim() });
      setMessage({ text: 'Button label saved.', type: 'success' });
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

      <form className="space-y-2 border-t pt-4" onSubmit={save}>
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
        <p className="text-sm">
          <span className="text-muted-foreground">Preview: </span>
          <span data-testid="entra-label-preview" className="inline-block rounded-md border px-3 py-1.5 font-medium">{label.trim() || DEFAULT_LABEL}</span>
        </p>
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
