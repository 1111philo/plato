import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import PasswordField from '../components/PasswordField.jsx';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const passwordRef = useRef(null);

  useEffect(() => {
    document.title = 'Sign in — plato';
  }, []);

  async function handleLogin() {
    if (!email.trim() || !password) {
      setError('Please enter email and password.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await login(email.trim(), password);
      navigate('/courses', { replace: true });
    } catch (e) {
      setError(e.message || 'Login failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-card">
        <h1>Sign in to plato</h1>
        {error && <div className="auth-error" role="alert">{error}</div>}
        <div className="form-group">
          <label htmlFor="login-email">Email</label>
          <input
            id="login-email"
            type="email"
            placeholder="you@example.com"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') passwordRef.current?.focus(); }}
          />
        </div>
        <div className="form-group">
          <label htmlFor="login-password">Password</label>
          <PasswordField
            id="login-password"
            autoComplete="current-password"
            inputRef={passwordRef}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleLogin(); }}
          />
        </div>
        <button className="primary-btn auth-submit" onClick={handleLogin} disabled={submitting}>
          {submitting ? 'Signing in...' : 'Sign in'}
        </button>
        <p className="auth-link">
          <button className="link-btn" onClick={() => navigate('/forgot-password')}>
            Forgot password?
          </button>
        </p>
      </div>
    </main>
  );
}
