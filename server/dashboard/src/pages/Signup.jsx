import { useState, useRef, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth';
import { api, fetchAffiliations } from '../api';
import Logo from '../components/Logo';
import Alert from '../components/Alert';
import PasswordInput from '../components/PasswordInput';
import Partners from '../components/Partners';

export default function Signup() {
  const [name, setName] = useState('');
  const [affiliation, setAffiliation] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [alert, setAlert] = useState(null);
  const [affiliations, setAffiliations] = useState([]);
  const { setAuth } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const confirmRef = useRef(null);

  useEffect(() => {
    document.title = 'Create account - Learn Service';
    fetchAffiliations().then(setAffiliations);
  }, []);

  async function handleSignup() {
    if (!name.trim() || !password) {
      setAlert({ message: 'Name and password are required.', type: 'error' });
      return;
    }
    if (password.length < 8) {
      setAlert({ message: 'Password must be at least 8 characters.', type: 'error' });
      return;
    }
    if (password !== confirm) {
      setAlert({ message: 'Passwords do not match.', type: 'error' });
      return;
    }
    const body = {
      inviteToken: token,
      name: name.trim(),
      password,
      affiliation: affiliation || undefined,
    };
    const data = await api('POST', '/v1/auth/signup', body);
    if (data._error) {
      setAlert({ message: data._error, type: 'error' });
      return;
    }
    setAuth(data);
    // Clean up ?token= from browser URL, matching original app behavior
    window.history.replaceState(null, '', window.location.pathname + '#/home');
    navigate('/home', { replace: true });
  }

  function goToLogin() {
    // Clean up ?token= from browser URL, matching original app behavior
    window.history.replaceState(null, '', window.location.pathname);
    navigate('/', { replace: true });
  }

  return (
    <div style={{ maxWidth: 440, margin: '60px auto' }}>
      <div className="card">
        <div className="centered logo-large">
          <Logo size={64} />
        </div>
        <h2 className="centered">Create your account</h2>
        <p className="onboarding-lead centered">You've been invited to join 1111 Learn.</p>
        <Alert
          message={alert?.message}
          type={alert?.type}
          onDismiss={() => setAlert(null)}
        />
        <div className="form-group">
          <label htmlFor="signup-name">Name</label>
          <input
            id="signup-name"
            type="text"
            placeholder="Your name"
            autoComplete="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="form-group">
          <label htmlFor="signup-affiliation">
            Affiliation{' '}
            <span style={{ fontWeight: 400, color: 'var(--color-text-secondary)' }}>(optional)</span>
          </label>
          <select
            id="signup-affiliation"
            value={affiliation}
            onChange={(e) => setAffiliation(e.target.value)}
            style={{
              width: '100%',
              padding: '10px 12px',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius)',
              fontSize: '14px',
              fontFamily: 'inherit',
              background: 'var(--color-bg)',
            }}
          >
            <option value="">Select affiliation</option>
            {affiliations.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label htmlFor="signup-password">Password</label>
          <PasswordInput
            id="signup-password"
            placeholder="At least 8 characters"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div className="form-group">
          <label htmlFor="signup-confirm">Confirm password</label>
          <PasswordInput
            id="signup-confirm"
            autoComplete="new-password"
            inputRef={confirmRef}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSignup();
            }}
          />
        </div>
        <button className="primary-btn" style={{ width: '100%' }} onClick={handleSignup}>
          Create account
        </button>
        <p style={{ textAlign: 'center', marginTop: 12 }}>
          <button className="link-btn" onClick={goToLogin}>
            Already have an account? Sign in
          </button>
        </p>
      </div>
      <div style={{ marginTop: 16 }}>
        <Partners />
      </div>
    </div>
  );
}
