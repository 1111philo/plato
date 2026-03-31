import { useState, useRef, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import PasswordField from '../components/PasswordField.jsx';

export default function Signup() {
  const [name, setName] = useState('');
  const [affiliation, setAffiliation] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [affiliations, setAffiliations] = useState([]);
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const confirmRef = useRef(null);

  useEffect(() => {
    document.title = 'Create account — plato';
    fetch('/v1/affiliations')
      .then(r => r.json())
      .then(d => setAffiliations(d.affiliations || []))
      .catch(() => {});
  }, []);

  async function handleSignup() {
    if (!name.trim() || !password) {
      setError('Name and password are required.');
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
      const res = await fetch('/v1/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inviteToken: token,
          name: name.trim(),
          password,
          affiliation: affiliation || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Signup failed');
      // Log in with the returned credentials
      await login(data.user?.email || '', password);
      navigate('/courses', { replace: true });
    } catch (e) {
      setError(e.message || 'Signup failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-card">
        <h1>Create your account</h1>
        <p className="auth-subtitle">You've been invited to join plato.</p>
        {error && <div className="auth-error" role="alert">{error}</div>}
        <div className="form-group">
          <label htmlFor="signup-name">Name</label>
          <input
            id="signup-name"
            type="text"
            placeholder="Your name"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        {affiliations.length > 0 && (
          <div className="form-group">
            <label htmlFor="signup-affiliation">Affiliation <span className="label-optional">(optional)</span></label>
            <select
              id="signup-affiliation"
              value={affiliation}
              onChange={(e) => setAffiliation(e.target.value)}
            >
              <option value="">Select affiliation</option>
              {affiliations.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
        )}
        <div className="form-group">
          <label htmlFor="signup-password">Password</label>
          <PasswordField
            id="signup-password"
            placeholder="At least 8 characters"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div className="form-group">
          <label htmlFor="signup-confirm">Confirm password</label>
          <PasswordField
            id="signup-confirm"
            autoComplete="new-password"
            inputRef={confirmRef}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSignup(); }}
          />
        </div>
        <button className="primary-btn auth-submit" onClick={handleSignup} disabled={submitting}>
          {submitting ? 'Creating...' : 'Create account'}
        </button>
        <p className="auth-link">
          <button className="link-btn" onClick={() => navigate('/login')}>
            Already have an account? Sign in
          </button>
        </p>
      </div>
    </main>
  );
}
