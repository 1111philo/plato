import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import PasswordField from '../components/PasswordField.jsx';

export default function Setup() {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    document.title = 'Setup — plato';
  }, []);

  async function handleSetup() {
    if (!email.trim() || !name.trim() || !password) {
      setError('All fields are required.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/v1/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), name: name.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Setup failed');
      // Log in with the new admin credentials
      await login(email.trim(), password);
      navigate('/plato-admin', { replace: true });
    } catch (e) {
      setError(e.message || 'Setup failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-card" style={{ maxWidth: 440 }}>
        <h1>Welcome to plato</h1>
        <p className="auth-subtitle">Create your admin account to get started.</p>
        {error && <div className="auth-error" role="alert">{error}</div>}
        <div className="form-group">
          <label htmlFor="setup-name">Name</label>
          <input id="setup-name" type="text" placeholder="Your name" autoComplete="name"
            value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div className="form-group">
          <label htmlFor="setup-email">Email</label>
          <input id="setup-email" type="email" placeholder="admin@example.com" autoComplete="email"
            value={email} onChange={e => setEmail(e.target.value)} />
        </div>
        <div className="form-group">
          <label htmlFor="setup-password">Password</label>
          <PasswordField id="setup-password" placeholder="At least 8 characters" autoComplete="new-password"
            value={password} onChange={e => setPassword(e.target.value)} />
        </div>
        <div className="form-group">
          <label htmlFor="setup-confirm">Confirm password</label>
          <PasswordField id="setup-confirm" autoComplete="new-password"
            value={confirm} onChange={e => setConfirm(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSetup(); }} />
        </div>
        <button className="primary-btn auth-submit" onClick={handleSetup} disabled={submitting}>
          {submitting ? 'Creating...' : 'Create admin account'}
        </button>
      </div>
    </main>
  );
}
