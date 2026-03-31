import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { api } from '../api';
import Logo from '../components/Logo';
import Alert from '../components/Alert';
import PasswordInput from '../components/PasswordInput';
import Partners from '../components/Partners';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [alert, setAlert] = useState(null);
  const { setAuth } = useAuth();
  const navigate = useNavigate();
  const passwordRef = useRef(null);

  useEffect(() => {
    document.title = 'Sign in - Learn Service';
  }, []);

  async function handleLogin() {
    if (!email.trim() || !password) {
      setAlert({ message: 'Please enter email and password.', type: 'error' });
      return;
    }
    const data = await api('POST', '/v1/auth/login', { email: email.trim(), password });
    if (data._error) {
      setAlert({ message: data._error, type: 'error' });
      return;
    }
    setAuth(data);
    // Clean URL and navigate, matching original app behavior
    window.history.replaceState(null, '', window.location.pathname + '#/home');
    navigate('/home', { replace: true });
  }

  return (
    <div style={{ maxWidth: 400, margin: '60px auto' }}>
      <div className="card">
        <div className="centered logo-large">
          <Logo size={64} />
        </div>
        <h2 className="centered">Sign in to Learn</h2>
        <Alert
          message={alert?.message}
          type={alert?.type}
          onDismiss={() => setAlert(null)}
        />
        <div className="form-group">
          <label htmlFor="login-email">Email</label>
          <input
            id="login-email"
            type="email"
            placeholder="you@example.com"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') passwordRef.current?.focus();
            }}
          />
        </div>
        <div className="form-group">
          <label htmlFor="login-password">Password</label>
          <PasswordInput
            id="login-password"
            autoComplete="current-password"
            inputRef={passwordRef}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleLogin();
            }}
          />
        </div>
        <button
          className="primary-btn"
          style={{ width: '100%' }}
          onClick={handleLogin}
        >
          Sign in
        </button>
        <p style={{ textAlign: 'center', marginTop: 12 }}>
          <button className="link-btn" onClick={() => navigate('/forgot-password')}>
            Forgot password?
          </button>
        </p>
      </div>
      <div style={{ marginTop: 16 }}>
        <Partners />
      </div>
    </div>
  );
}
