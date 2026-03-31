import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import Alert from '../components/Alert';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [alert, setAlert] = useState(null);
  const navigate = useNavigate();
  const emailRef = useRef(null);

  useEffect(() => {
    document.title = 'Reset password - Learn Service';
  }, []);

  async function handleSubmit() {
    if (!email.trim()) {
      setAlert({ message: 'Please enter your email.', type: 'error' });
      return;
    }
    const data = await api('POST', '/v1/auth/forgot-password', { email: email.trim() });
    if (data._error) {
      setAlert({ message: data._error, type: 'error' });
      return;
    }
    setAlert({
      message: 'If that email exists, a reset link has been sent. Check your inbox.',
      type: 'success',
    });
  }

  return (
    <div className="card" style={{ maxWidth: 400, margin: '60px auto' }}>
      <h2 className="centered">Reset password</h2>
      <p className="onboarding-lead centered">
        Enter your email and we'll send you a reset link.
      </p>
      <Alert
        message={alert?.message}
        type={alert?.type}
        onDismiss={() => setAlert(null)}
      />
      <div className="form-group">
        <label htmlFor="forgot-email">Email</label>
        <input
          id="forgot-email"
          type="email"
          placeholder="you@example.com"
          autoComplete="email"
          ref={emailRef}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSubmit();
          }}
        />
      </div>
      <button className="primary-btn" style={{ width: '100%' }} onClick={handleSubmit}>
        Send reset link
      </button>
      <p style={{ textAlign: 'center', marginTop: 12 }}>
        <button className="link-btn" onClick={() => navigate('/')}>
          Back to sign in
        </button>
      </p>
    </div>
  );
}
