import { useState, useRef, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import PasswordField from '../components/PasswordField.jsx';

export default function ResetPassword() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('reset') || '';
  const confirmRef = useRef(null);

  useEffect(() => {
    document.title = 'Set new password — 1111 Learn';
  }, []);

  async function handleReset() {
    if (!password) {
      setError('Please enter a new password.');
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
    setError('');
    try {
      const res = await fetch('/v1/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resetToken: token, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Reset failed');
      }
      setMessage('Password reset. You can now sign in.');
      setTimeout(() => navigate('/login', { replace: true }), 2000);
    } catch (e) {
      setError(e.message || 'Reset failed');
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-card">
        <h1>Set new password</h1>
        {error && <div className="auth-error" role="alert">{error}</div>}
        {message && <div className="auth-success" role="status">{message}</div>}
        <div className="form-group">
          <label htmlFor="reset-password">New password</label>
          <PasswordField
            id="reset-password"
            placeholder="At least 8 characters"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div className="form-group">
          <label htmlFor="reset-confirm">Confirm password</label>
          <PasswordField
            id="reset-confirm"
            autoComplete="new-password"
            inputRef={confirmRef}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleReset(); }}
          />
        </div>
        <button className="primary-btn auth-submit" onClick={handleReset}>
          Reset password
        </button>
      </div>
    </main>
  );
}
