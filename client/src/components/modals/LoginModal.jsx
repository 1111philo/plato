import { useState, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useModal } from '../../contexts/ModalContext.jsx';
import { useApp } from '../../contexts/AppContext.jsx';
import PasswordField from '../PasswordField.jsx';
import { getPreferences, savePreferences } from '../../../js/storage.js';
import * as sync from '../../../js/sync.js';
import { loadCourses, invalidateCoursesCache } from '../../../js/courseOwner.js';
import { forgotPassword } from '../../../js/auth.js';

export default function LoginModal({ onSuccess, message }) {
  const [email, setEmail] = useState(globalThis.__envCredentials?.email || '');
  const [password, setPassword] = useState(globalThis.__envCredentials?.password || '');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [view, setView] = useState('login'); // 'login' | 'forgot' | 'sent'
  const passwordRef = useRef(null);
  const { login } = useAuth();
  const { hide } = useModal();
  const { dispatch } = useApp();

  const handleSubmit = async (e) => {
    e?.preventDefault();
    if (!email.trim() || !password) {
      setError('Please enter email and password.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const authUser = await login(email.trim(), password);

      // Pull server data first (server is source of truth)
      try {
        await sync.loadAll();
      } catch { /* offline — keep local data */ }

      // Sync auth name into local preferences
      if (authUser?.name) {
        const prefs = { ...(await getPreferences()), name: authUser.name };
        await savePreferences(prefs);
      }

      // Refresh all React state from local storage (now populated from server)
      invalidateCoursesCache();
      const freshPrefs = await getPreferences();
      const courses = await loadCourses();
      dispatch({ type: 'INIT_DATA', payload: { preferences: freshPrefs, courses } });

      setTimeout(() => {
        hide();
        if (onSuccess) onSuccess();
      }, 500);
    } catch (err) {
      setError(err.message || 'Invalid email or password');
      setSubmitting(false);
    }
  };

  const handleForgotSubmit = async (e) => {
    e?.preventDefault();
    if (!email.trim()) {
      setError('Please enter your email.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await forgotPassword(email.trim());
      setView('sent');
    } catch (err) {
      setError(err.message || 'Request failed');
    } finally {
      setSubmitting(false);
    }
  };

  if (view === 'sent') {
    return (
      <>
        <h2>Check Your Email</h2>
        <p>If an account exists for <strong>{email}</strong>, a reset link has been sent. Check your inbox.</p>
        <div className="action-bar">
          <button className="primary-btn" onClick={() => { setView('login'); setError(''); }}>
            Back to Sign In
          </button>
        </div>
      </>
    );
  }

  if (view === 'forgot') {
    return (
      <>
        <h2>Reset Password</h2>
        <p>Enter your email and we'll send a reset link.</p>
        <form className="settings-form" onSubmit={handleForgotSubmit} action="#">
          <label htmlFor="modal-forgot-email">Email</label>
          <input
            id="modal-forgot-email"
            type="email"
            name="email"
            required
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleForgotSubmit(e); }}
            disabled={submitting}
          />
          {error && <div className="login-error-msg" role="status" aria-live="polite">{error}</div>}
          <div className="action-bar">
            <button type="button" className="secondary-btn" onClick={() => { setView('login'); setError(''); }} disabled={submitting}>
              Back
            </button>
            <button type="submit" className="primary-btn" disabled={submitting}>
              {submitting ? 'Sending...' : 'Send Reset Link'}
            </button>
          </div>
        </form>
      </>
    );
  }

  return (
    <>
      <h2>Sign In</h2>
      {message
        ? <p>{message}</p>
        : <p>Sign in to sync your data with{' '}
            <a href="https://learn.philosophers.group" target="_blank" rel="noopener">1111 Learn</a>.
          </p>
      }
      <form className="settings-form" onSubmit={handleSubmit} action="#">
        <label htmlFor="modal-login-email">Email</label>
        <input
          id="modal-login-email"
          type="email"
          name="email"
          required
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') passwordRef.current?.focus(); }}
          disabled={submitting}
        />
        <label htmlFor="modal-login-password">Password</label>
        <PasswordField
          id="modal-login-password"
          name="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
          inputRef={passwordRef}
          required
          disabled={submitting}
        />
        <button type="button" className="link-btn" onClick={() => { setView('forgot'); setError(''); }}>
          Forgot password?
        </button>
        {error && <div className="login-error-msg" role="status" aria-live="polite">{error}</div>}
        <div className="action-bar">
          <button type="button" className="secondary-btn" onClick={hide} disabled={submitting}>Cancel</button>
          <button type="submit" className="primary-btn" disabled={submitting}>
            {submitting ? 'Signing in...' : 'Sign In'}
          </button>
        </div>
      </form>
    </>
  );
}
