import { useState, useRef, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import Alert from '../components/Alert';
import PasswordInput from '../components/PasswordInput';

export default function ResetPassword() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [alert, setAlert] = useState(null);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('reset') || '';
  const confirmRef = useRef(null);

  useEffect(() => {
    document.title = 'Set new password - Learn Service';
  }, []);

  async function handleReset() {
    if (!password) {
      setAlert({ message: 'Please enter a new password.', type: 'error' });
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
    const data = await api('POST', '/v1/auth/reset-password', {
      resetToken: token,
      password,
    });
    if (data._error) {
      setAlert({ message: data._error, type: 'error' });
      return;
    }
    setAlert({ message: 'Password reset. You can now sign in.', type: 'success' });
    setTimeout(() => {
      // Clean up ?reset= from browser URL, matching original app behavior
      window.history.replaceState(null, '', window.location.pathname);
      navigate('/', { replace: true });
    }, 2000);
  }

  return (
    <div className="card" style={{ maxWidth: 400, margin: '60px auto' }}>
      <h2 className="centered">Set new password</h2>
      <Alert
        message={alert?.message}
        type={alert?.type}
        onDismiss={() => setAlert(null)}
      />
      <div className="form-group">
        <label htmlFor="reset-password">New password</label>
        <PasswordInput
          id="reset-password"
          placeholder="At least 8 characters"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <div className="form-group">
        <label htmlFor="reset-confirm">Confirm password</label>
        <PasswordInput
          id="reset-confirm"
          autoComplete="new-password"
          inputRef={confirmRef}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleReset();
          }}
        />
      </div>
      <button className="primary-btn" style={{ width: '100%' }} onClick={handleReset}>
        Reset password
      </button>
    </div>
  );
}
