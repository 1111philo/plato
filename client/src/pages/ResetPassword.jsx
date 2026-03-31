import { useState, useRef, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import PasswordField from '../components/PasswordField.jsx';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Card, CardHeader, CardTitle, CardContent,
} from '@/components/ui/card';

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
    document.title = 'Set new password — plato';
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
    <main className="min-h-dvh flex items-center justify-center bg-muted p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">Set new password</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="bg-destructive/10 text-destructive border border-destructive/20 rounded-lg p-3 text-sm" role="alert">
              {error}
            </div>
          )}
          {message && (
            <div className="bg-green-50 text-green-700 border border-green-200 rounded-lg p-3 text-sm" role="status">
              {message}
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="reset-password">New password</Label>
            <PasswordField
              id="reset-password"
              placeholder="At least 8 characters"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="reset-confirm">Confirm password</Label>
            <PasswordField
              id="reset-confirm"
              autoComplete="new-password"
              inputRef={confirmRef}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleReset(); }}
            />
          </div>
          <Button className="w-full" onClick={handleReset}>
            Reset password
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
