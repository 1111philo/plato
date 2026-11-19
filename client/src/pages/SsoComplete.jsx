import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import usePublicBranding from '../hooks/usePublicBranding.js';
import { exchangeSsoCode, localPath, providerName, ssoCodeFromHash, ssoErrorMessage, SSO_EXPIRED_MESSAGE } from '../lib/sso.js';
import { getAuthTokens } from '../../js/storage.js';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardContent, CardFooter } from '@/components/ui/card';

// Where a single sign-on comes back to (docs/SSO.md): `/sso/complete#code=…`.
// Trades the one-time code for the outcome, then signs the person in, sends
// them back to Settings (connecting), or says why there's no account.
export default function SsoComplete() {
  const [code] = useState(() => ssoCodeFromHash(window.location.hash));
  const [result, setResult] = useState(() => (code ? null : { outcome: 'expired' }));
  const { loggedIn, completeSsoLogin } = useAuth();
  const navigate = useNavigate();
  const branding = usePublicBranding('Sign in');
  const headingRef = useRef(null);
  const wasLoggedIn = useRef(loggedIn);

  useEffect(() => {
    // The code is single-use and short-lived, but it still shouldn't sit in
    // the address bar or the history entry.
    if (window.location.hash) window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
    if (!code) return undefined;
    let live = true;
    getAuthTokens().catch(() => null).then((tokens) => exchangeSsoCode(code, fetch, tokens?.accessToken || null)).then(async (r) => {
      if (!live) return;
      if (r.outcome === 'signed_in') {
        try {
          const user = await completeSsoLogin(r);
          const next = localPath(r.next);
          // Someone was already signed in on this browser: reload, so nothing
          // the app loaded for that session is left on screen.
          if (wasLoggedIn.current) { window.location.replace(next); return; }
          // A new account's username was made up: the Lessons page says it once, as after signup.
          navigate(next, { replace: true, state: r.created && next === '/lessons' && user.username ? { newUsername: user.username } : null });
        } catch {
          if (live) setResult({ outcome: 'expired' });
        }
        return;
      }
      if (r.outcome === 'linked') {
        navigate('/settings', { replace: true, state: { ssoNotice: `${providerName(r.label)} is now connected.` } });
        return;
      }
      setResult(r);
    });
    return () => { live = false; };
  }, [code, completeSsoLogin, navigate]);

  // Move the reading position to what happened.
  const screen = result?.outcome || null;
  useEffect(() => {
    if (screen && branding) headingRef.current?.focus();
  }, [screen, !!branding]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!branding) return null;

  let title = null;
  let body = null;
  let action = null;
  if (!result) {
    body = (
      <p role="status" className="flex items-center gap-2 text-muted-foreground">
        <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" aria-hidden="true" />
        Signing you in…
      </p>
    );
  } else if (result.outcome === 'no_account' && result.onWaitlist) {
    title = 'You’re on the wait list';
    body = <p>We’ll email you when you’re invited.</p>;
  } else if (result.outcome === 'no_account') {
    title = 'You don’t have an account yet';
    body = (
      <>
        <p>{branding.classroomName} is invite-only.{result.email ? <> You signed in as <strong className="break-all">{result.email}</strong>.</> : null}</p>
        {!result.waitlistOpen && <p>Ask your program team for an invite.</p>}
      </>
    );
    if (result.waitlistOpen) {
      action = (
        <Button
          className="w-full"
          onClick={() => navigate('/waitlist', {
            // In memory only (router state): never the URL or localStorage.
            state: { sso: { ticket: result.ticket || null, email: result.email || '', firstName: result.firstName || '', lastName: result.lastName || '' } },
          })}
        >
          Join the wait list
        </Button>
      );
    }
  } else if (result.outcome === 'error') {
    title = 'We couldn’t sign you in';
    body = <p role="alert">{ssoErrorMessage(result.code, result.label)}</p>;
  } else {
    title = 'That sign-in link has expired';
    body = <p role="alert">{SSO_EXPIRED_MESSAGE}</p>;
  }

  return (
    <main className="min-h-dvh shrink-0 flex flex-col items-center justify-center p-4" style={{ backgroundColor: branding.primary }}>
      {branding.logo ? (<img src={branding.logo} alt={branding.classroomName} className="h-16 w-16 mb-6 rounded-lg object-contain" />) : (<h1 className="text-2xl font-bold text-white mb-6">{branding.classroomName}</h1>)}
      <Card className="w-full max-w-md">
        {title && (
          <CardHeader>
            <h2 ref={headingRef} tabIndex={-1} className="font-heading text-2xl leading-snug font-medium">{title}</h2>
          </CardHeader>
        )}
        <CardContent className="space-y-4">
          {body}
          {action}
        </CardContent>
        {result && (
          <CardFooter className="justify-center">
            {loggedIn
              ? <Button variant="link" onClick={() => navigate('/settings', { replace: true })}>Back to Settings</Button>
              : <Button variant="link" onClick={() => navigate('/login', { replace: true })}>Back to sign in</Button>}
          </CardFooter>
        )}
      </Card>
      <p className="mt-4 text-xs text-white/90">
        <a href="/privacy" onClick={e => { e.preventDefault(); navigate('/privacy'); }} className="underline hover:text-white">Privacy</a>
        {' · '}
        Powered by <a href="https://github.com/1111philo/plato" target="_blank" rel="noopener noreferrer" className="underline hover:text-white">plato</a>.
      </p>
    </main>
  );
}
