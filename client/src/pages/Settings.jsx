import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import PasswordField from '../components/PasswordField.jsx';
import {
  savePreferences,
  getLearnerProfileSummary, getLearnerProfile,
  saveLearnerProfile, saveLearnerProfileSummary,
} from '../../js/storage.js';
import { updateProfile, getMyFields, authenticatedFetch } from '../../js/auth.js';
import { useApp } from '../contexts/AppContext.jsx';
import { SEND_KEYS, sendKeyOf, isMacLike } from '../lib/chatPrefs.js';
import { missingRequired, pickValues } from '../lib/userFields.js';
import CustomFieldInput from '../components/CustomFieldInput.jsx';
import NameFields from '../components/NameFields.jsx';
import { fetchSsoProviders, providerName, ssoReasonMessage } from '../lib/sso.js';
import * as orchestrator from '../../js/orchestrator.js';
import { syncIfUnsaved } from '../lib/syncDebounce.js';
import { ensureProfileExists, mergeProfile, withLearnerNote, withoutLearnerNote, queueProfileUpdate } from '../lib/profileQueue.js';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader,
  AlertDialogTitle, AlertDialogDescription, AlertDialogFooter,
  AlertDialogAction, AlertDialogCancel,
} from '@/components/ui/alert-dialog';

export default function Settings() {
  const { user, refreshUser } = useAuth();
  const [name, setName] = useState({ firstName: user?.firstName || '', lastName: user?.lastName || '' });
  const [username, setUsername] = useState(user?.username || '');
  const [profileSummary, setProfileSummary] = useState('');
  const [learnerNotes, setLearnerNotes] = useState([]);

  // Remove one of the learner's notes. The profile agent then revises the
  // profile so it stops following that note (in the background).
  async function removeNote(index) {
    const profile = await ensureProfileExists();
    const removed = profile.learnerNotes?.[index];
    if (!removed) return;
    const next = withoutLearnerNote(profile, index);
    syncIfUnsaved(await saveLearnerProfile(next), 'profile');
    setLearnerNotes(next.learnerNotes);
    queueProfileUpdate(async () => {
      const current = await ensureProfileExists();
      const result = await orchestrator.updateProfileFromFeedback(current, removed.text, {
        lessonName: 'Settings', activityType: 'feedback', activityGoal: 'User removed a profile note',
      }, 'learner-removed');
      if (result?.profile) {
        syncIfUnsaved(await saveLearnerProfile(mergeProfile(current, result.profile)), 'profile');
        if (result.summary) { syncIfUnsaved(await saveLearnerProfileSummary(result.summary), 'profileSummary'); setProfileSummary(result.summary); }
      }
    });
  }

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordFeedback, setPasswordFeedback] = useState('');
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);
  const [nameFeedback, setNameFeedback] = useState('');
  const [usernameFeedback, setUsernameFeedback] = useState('');
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [userFields, setUserFields] = useState([]);
  const [fieldValues, setFieldValues] = useState({});
  const [fieldsFeedback, setFieldsFeedback] = useState('');
  const [fieldsSaving, setFieldsSaving] = useState(false);

  useEffect(() => {
    (async () => {
      setProfileSummary(await getLearnerProfileSummary());
      setLearnerNotes((await getLearnerProfile())?.learnerNotes || []);
    })();
    getMyFields()
      .then((data) => {
        setUserFields(data.userFields || []);
        setFieldValues(data.values || {});
      })
      .catch(() => {});
  }, []);

  const handleSaveFields = async (e) => {
    e.preventDefault();
    if (missingRequired(userFields, fieldValues).length) {
      setFieldsFeedback('Fill in all required fields.');
      return;
    }
    setFieldsSaving(true);
    try {
      const data = await updateProfile({ customFields: pickValues(fieldValues, userFields.map((f) => f.id)) });
      setFieldValues(data.customFields || {});
      setFieldsFeedback('Saved!');
    } catch (err) {
      setFieldsFeedback(err.message || 'Failed to update');
    } finally {
      setFieldsSaving(false);
    }
    setTimeout(() => setFieldsFeedback(''), 3000);
  };

  const handleSaveUsername = async (e) => {
    e.preventDefault();
    const trimmed = username.trim();
    if (!trimmed) {
      setUsernameFeedback('Username is required');
      setTimeout(() => setUsernameFeedback(''), 2000);
      return;
    }
    try {
      await updateProfile({ username: trimmed });
      await refreshUser();
      setUsernameFeedback('Saved!');
    } catch (err) {
      setUsernameFeedback(err.message || 'Failed to update');
    }
    setTimeout(() => setUsernameFeedback(''), 2000);
  };

  const handleSaveName = async (e) => {
    e.preventDefault();
    // Names live on the account (#402), not in preferences.
    const next = { firstName: name.firstName.trim(), lastName: name.lastName.trim() };
    if (!next.firstName) {
      setNameFeedback('First name is required.');
      return;
    }
    try {
      await updateProfile(next);
      await refreshUser();
      setNameFeedback('Saved!');
    } catch (err) {
      setNameFeedback(err.message || 'Failed to update');
    }
    setTimeout(() => setNameFeedback(''), 2000);
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    if (!currentPassword) {
      setPasswordFeedback('Enter your current password.');
      return;
    }
    if (!newPassword || newPassword.length < 8) {
      setPasswordFeedback('Password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordFeedback('Passwords do not match.');
      return;
    }
    setPasswordSubmitting(true);
    setPasswordFeedback('');
    try {
      // Signs out every other device; this one stays signed in (lib/sessions.js).
      await updateProfile({ password: newPassword, currentPassword });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordFeedback('Password changed. Other devices are signed out.');
    } catch (err) {
      setPasswordFeedback(err.message || 'Failed to change password');
    } finally {
      setPasswordSubmitting(false);
      setTimeout(() => setPasswordFeedback(''), 3000);
    }
  };

  const passwordForm = (
    <form className="space-y-3" onSubmit={handleChangePassword}>
      <div className="space-y-1.5">
        <Label htmlFor="current-password">Current Password</Label>
        <PasswordField
          id="current-password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          disabled={passwordSubmitting}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="new-password">New Password</Label>
        <PasswordField
          id="new-password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          disabled={passwordSubmitting}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="confirm-password">Confirm Password</Label>
        <PasswordField
          id="confirm-password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleChangePassword(e); } }}
          disabled={passwordSubmitting}
        />
      </div>
      <Button type="submit" disabled={passwordSubmitting}>
        {passwordSubmitting ? 'Changing...' : 'Change Password'}
      </Button>
      {passwordFeedback && <p className="text-sm text-muted-foreground" role="status" aria-live="polite">{passwordFeedback}</p>}
    </form>
  );

  return (
    <div className="mx-auto max-w-lg space-y-6 p-4">
      <h2 className="text-xl font-semibold">User Settings</h2>

      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Email</span>
            <span className="text-sm">{user?.email || ''}</span>
          </div>

          <Separator />

          <form className="space-y-3" onSubmit={handleSaveUsername}>
            <div className="space-y-1.5">
              <Label htmlFor="account-username">Username</Label>
              <Input id="account-username" type="text" value={username} onChange={(e) => setUsername(e.target.value)} />
            </div>
            <Button type="submit">Save</Button>
            {usernameFeedback && <p className="text-sm text-muted-foreground" role="status" aria-live="polite">{usernameFeedback}</p>}
          </form>

          <Separator />

          <form className="space-y-3" onSubmit={handleSaveName}>
            <NameFields idPrefix="account" value={name} onChange={setName} inferred={user?.nameSource === 'auto'} />
            <Button type="submit">Save</Button>
            {nameFeedback && <p className="text-sm text-muted-foreground" role="status" aria-live="polite">{nameFeedback}</p>}
          </form>

        </CardContent>
      </Card>

      <SignInMethods>{passwordForm}</SignInMethods>

      {userFields.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handleSaveFields} noValidate>
              {userFields.map((f) => (
                <CustomFieldInput
                  key={f.id}
                  field={f}
                  idPrefix="settings-field"
                  value={fieldValues[f.id]}
                  onChange={(v) => setFieldValues((prev) => ({ ...prev, [f.id]: v }))}
                  disabled={fieldsSaving}
                />
              ))}
              <Button type="submit" disabled={fieldsSaving}>
                {fieldsSaving ? 'Saving...' : 'Save'}
              </Button>
              {fieldsFeedback && <p className="text-sm text-muted-foreground" role="status" aria-live="polite">{fieldsFeedback}</p>}
            </form>
          </CardContent>
        </Card>
      )}

      <ChatPreferences />

      <EmailPreferences />

      <Card>
        <CardHeader>
          <CardTitle id="profile-heading">Learner Profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">Updated automatically by the AI as you complete activities.</p>
          <div className="rounded-md bg-muted p-3 text-sm leading-relaxed" aria-labelledby="profile-heading">
            {profileSummary || <em className="text-muted-foreground">No profile yet. Complete an activity to build your profile.</em>}
          </div>
          {learnerNotes.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium">What you&rsquo;ve told plato</h3>
              <p className="text-xs text-muted-foreground">Your profile always follows these, even as lessons update it.</p>
              <ul className="space-y-2" aria-label="Your notes">
                {learnerNotes.map((n, i) => (
                  <li key={`${n.at}-${i}`} className="flex items-start gap-2 rounded-md border px-3 py-2 text-sm">
                    <span className="flex-1 whitespace-pre-wrap">{n.text}</span>
                    <Button variant="ghost" size="xs" aria-label={`Remove note: ${n.text.slice(0, 60)}`} onClick={() => removeNote(i)}>Remove</Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Button variant="outline" onClick={() => setFeedbackOpen(true)}>
            Add Feedback
          </Button>
        </CardContent>
      </Card>

      <ProfileFeedbackDialog
        open={feedbackOpen}
        onOpenChange={setFeedbackOpen}
        onDone={async () => {
          setProfileSummary(await getLearnerProfileSummary());
          setLearnerNotes((await getLearnerProfile())?.learnerNotes || []);
        }}
      />
    </div>
  );
}

// How this account signs in: its password, and a single sign-on identity
// (docs/SSO.md). `children` is the change-password form, shown only when a
// password is set (it asks for the current one). The provider rows appear
// only when SSO is on or this account is already connected.
function SignInMethods({ children }) {
  const { user: authUser } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  // What a single sign-on round trip came back with: "connected" from
  // /sso/complete, or a failure reason from /login?sso=… (App.jsx LoginRoute).
  const [arrival] = useState(() => ({ notice: location.state?.ssoNotice || '', reason: location.state?.ssoReason || '' }));
  const [signIn, setSignIn] = useState(null);
  const [providers, setProviders] = useState([]);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const loadSignIn = () => authenticatedFetch('/v1/me')
    .then((r) => (r.ok ? r.json() : null))
    .then((me) => setSignIn(me?.signIn || null))
    .catch(() => {});

  useEffect(() => {
    let live = true;
    Promise.all([fetchSsoProviders(), loadSignIn()]).then(([list]) => {
      if (!live) return;
      setProviders(list);
      // Set after the first render so the live regions announce them.
      if (arrival.notice) setNotice(arrival.notice);
      if (arrival.reason) setError(ssoReasonMessage(arrival.reason, list));
    });
    // Shown once: a reload or Back shouldn't repeat it.
    if (arrival.notice || arrival.reason) navigate('.', { replace: true, state: null });
    return () => { live = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const linked = signIn?.sso || null;
  // The connected provider first (even if it has since been turned off), then
  // the ones on offer. An account holds one identity, so nothing else can be
  // connected while one is.
  const rows = linked
    ? [{ id: linked.provider, name: providerName(providers.find((p) => p.id === linked.provider)?.label || 'Single sign-on') }]
    : providers.map((p) => ({ id: p.id, name: providerName(p.label) }));

  async function connect(id, name) {
    setBusy(true); setError(''); setNotice('');
    try {
      const res = await authenticatedFetch(`/v1/auth/sso/${encodeURIComponent(id)}/link`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) throw new Error();
      window.location.assign(data.url);
    } catch {
      setError(`Connecting ${name} isn’t available right now.`);
      setBusy(false);
    }
  }

  function askDisconnect() {
    setError(''); setNotice('');
    // Without a password this is the only way in; the server refuses too.
    if (signIn && !signIn.password) { setError('Set a password first, so you can still sign in.'); return; }
    setConfirmOpen(true);
  }

  async function disconnect(name) {
    setConfirmOpen(false);
    setBusy(true);
    try {
      const res = await authenticatedFetch('/v1/auth/sso/disconnect', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.code === 'no_password' ? 'Set a password first, so you can still sign in.' : 'Couldn’t disconnect. Try again.');
      await loadSignIn();
      setNotice(`${name} disconnected.`);
    } catch (err) {
      setError(err.message === 'Session expired' ? 'Couldn’t disconnect. Try again.' : err.message);
    } finally {
      setBusy(false);
    }
  }

  const noPassword = !!signIn && !signIn.password;

  // An account made by single sign-on has no password. The reset email is how
  // one is added: it proves the address, and the link works while signed in.
  async function emailSetPasswordLink() {
    setBusy(true); setError(''); setNotice('');
    try {
      const res = await fetch('/v1/auth/forgot-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: authUser?.email }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Couldn’t send the link. Please try again.');
      setNotice(`We sent a link to ${authUser?.email}. It works for 1 hour.`);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign-in methods</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground min-h-5 empty:hidden" role="status" aria-live="polite">{notice}</p>
        {error && <p className="text-sm text-red-800 dark:text-destructive" role="alert">{error}</p>}

        {rows.map((row) => (
          <div key={row.id} className="flex items-center justify-between gap-3">
            <div className="min-w-0 text-sm">
              <div className="font-medium">{row.name}</div>
              <div className="text-muted-foreground break-all">
                {linked ? (linked.email ? `Connected as ${linked.email}` : 'Connected') : 'Not connected'}
              </div>
            </div>
            {linked
              ? <Button variant="outline" disabled={busy} aria-label={`Disconnect ${row.name}`} onClick={askDisconnect}>Disconnect</Button>
              : <Button variant="outline" disabled={busy} onClick={() => connect(row.id, row.name)}>Connect {row.name}</Button>}
          </div>
        ))}
        {rows.length > 0 && <Separator />}

        {noPassword ? (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <div className="flex-1">
              <div className="font-medium">Password</div>
              <div className="text-muted-foreground">Not set</div>
            </div>
            <Button variant="outline" disabled={busy} onClick={emailSetPasswordLink}>Email me a link to set one</Button>
          </div>
        ) : (
          <>
            {rows.length > 0 && <div className="text-sm font-medium">Password</div>}
            {children}
          </>
        )}
      </CardContent>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect {rows[0]?.name}?</AlertDialogTitle>
            <AlertDialogDescription>You’ll sign in with your password.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive/10 text-red-800 dark:text-destructive hover:bg-destructive/20"
              onClick={() => disconnect(rows[0]?.name)}
            >
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function ProfileFeedbackDialog({ open, onOpenChange, onDone }) {
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!text.trim()) return;
    setSubmitting(true);
    try {
      // Keep the learner's words verbatim first: later updates can't drop them.
      const profile = withLearnerNote(await ensureProfileExists(), text);
      syncIfUnsaved(await saveLearnerProfile(profile), 'profile');
      const result = await orchestrator.updateProfileFromFeedback(profile, text.trim(), {
        lessonName: 'Settings', activityType: 'feedback', activityGoal: 'User-provided profile feedback',
      }, 'learner');
      if (result?.profile) {
        const merged = mergeProfile(profile, result.profile);
        syncIfUnsaved(await saveLearnerProfile(merged), 'profile');
        if (result.summary) syncIfUnsaved(await saveLearnerProfileSummary(result.summary), 'profileSummary');
      }
      onOpenChange(false);
      setText('');
      if (onDone) onDone();
    } catch (e) {
      console.error('[plato] Profile feedback failed:', e?.message || e);
      setSubmitting(false);
      if (onDone) onDone(); // the note itself was saved; show it
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Profile Feedback</DialogTitle>
          <DialogDescription>
            Share anything that seems inaccurate or missing -- your device, experience level, learning style, or anything else.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="profile-feedback-input" className="sr-only">Profile feedback</Label>
          <Textarea
            id="profile-feedback-input"
            rows={4}
            placeholder="e.g. I'm a complete beginner. I use a Chromebook and don't have admin access."
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleSubmit(); } }}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Updating...' : 'Submit'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// How messages are sent, in every chat (#247).
// Saved to the preferences record as soon as an option changes.
function ChatPreferences() {
  const { state, dispatch } = useApp();
  const [feedback, setFeedback] = useState('');
  const prefs = state.preferences || {};
  const sendKey = sendKeyOf(prefs);
  const mod = isMacLike() ? '⌘' : 'Ctrl';

  async function update(patch) {
    const next = { ...prefs, ...patch };
    dispatch({ type: 'SET_PREFERENCES', preferences: next });
    try {
      syncIfUnsaved(await savePreferences(next), 'preferences');
      setFeedback('Saved.');
    } catch {
      setFeedback('Couldn’t save. Try again.');
    }
    setTimeout(() => setFeedback(''), 2000);
  }

  const option = 'flex items-start gap-2 text-sm';
  return (
    <Card>
      <CardHeader>
        <CardTitle>Chat</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium mb-1">Send a message with</legend>
          <label className={option}>
            <input type="radio" name="send-key" className="mt-0.5 accent-primary" checked={sendKey === SEND_KEYS.MOD_ENTER}
              onChange={() => update({ sendKey: SEND_KEYS.MOD_ENTER })} />
            <span>{mod}+Enter <span className="text-muted-foreground">(Enter adds a new line)</span></span>
          </label>
          <label className={option}>
            <input type="radio" name="send-key" className="mt-0.5 accent-primary" checked={sendKey === SEND_KEYS.ENTER}
              onChange={() => update({ sendKey: SEND_KEYS.ENTER })} />
            <span>Enter <span className="text-muted-foreground">(Shift+Enter adds a new line)</span></span>
          </label>
        </fieldset>
        <p className="text-sm text-muted-foreground min-h-5" role="status" aria-live="polite">{feedback}</p>
      </CardContent>
    </Card>
  );
}

// Which optional emails the learner gets (#400). Saved on change to the
// server-only notify:state record through /v1/me/notifications. Checked
// means "send it"; the server stores opt-outs.
const EMAIL_KINDS = [
  { key: 'nudge', label: 'Reminders to finish a lesson I started' },
  { key: 'digest', label: 'A weekly summary of my progress and new lessons' },
  { key: 'messages', label: 'Messages from my classroom' },
];

function EmailPreferences() {
  const [optOut, setOptOut] = useState(null);
  const [feedback, setFeedback] = useState('');

  useEffect(() => {
    let cancelled = false;
    authenticatedFetch('/v1/me/notifications')
      .then((r) => (r.ok ? r.json() : { optOut: {} }))
      .then((d) => { if (!cancelled) setOptOut(d.optOut || {}); })
      .catch(() => { if (!cancelled) setOptOut({}); });
    return () => { cancelled = true; };
  }, []);

  async function update(key, receive) {
    const before = optOut;
    setOptOut({ ...optOut, [key]: !receive });
    try {
      const res = await authenticatedFetch('/v1/me/notifications', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ optOut: { [key]: !receive } }),
      });
      if (!res.ok) throw new Error();
      setFeedback('Saved.');
    } catch {
      setOptOut(before);
      setFeedback('Couldn’t save. Try again.');
    }
    setTimeout(() => setFeedback(''), 2000);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Email</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <fieldset className="space-y-2" disabled={!optOut}>
          <legend className="text-sm font-medium mb-1">Email me</legend>
          {EMAIL_KINDS.map((k) => (
            <label key={k.key} className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5 accent-primary" checked={!optOut?.[k.key]} onChange={(e) => update(k.key, e.target.checked)} />
              <span>{k.label}</span>
            </label>
          ))}
        </fieldset>
        <p className="text-sm text-muted-foreground min-h-5" role="status" aria-live="polite">{feedback}</p>
      </CardContent>
    </Card>
  );
}
