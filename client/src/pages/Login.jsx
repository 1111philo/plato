import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import usePublicBranding from '../hooks/usePublicBranding.js';
import PasswordField from '../components/PasswordField.jsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card, CardHeader, CardTitle, CardContent, CardFooter,
} from '@/components/ui/card';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const passwordRef = useRef(null);
  const branding = usePublicBranding('Sign in');

  async function handleLogin() {
    if (!email.trim() || !password) {
      setError('Please enter email/username and password.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await login(email.trim(), password);
      navigate('/lessons', { replace: true });
    } catch (e) {
      setError(e.message || 'Login failed');
    } finally {
      setSubmitting(false);
    }
  }

  if (!branding) return null;

  const { primary: headerBg, logo, classroomName } = branding;

  return (
    <main className="min-h-dvh flex flex-col items-center justify-center p-4" style={{ backgroundColor: headerBg }}>
      {logo ? (
        <img src={logo} alt={classroomName} className="h-16 w-16 mb-6 rounded-lg object-contain" />
      ) : (
        <h1 className="text-2xl font-bold text-white mb-6">{classroomName}</h1>
      )}
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">Sign in</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="bg-destructive/10 text-destructive border border-destructive/20 rounded-lg p-3 text-sm" role="alert">
              {error}
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="login-email">Email or Username</Label>
            <Input id="login-email" type="text" placeholder="you@example.com or username" autoComplete="username"
              value={email} onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') passwordRef.current?.focus(); }} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="login-password">Password</Label>
            <PasswordField id="login-password" autoComplete="current-password" inputRef={passwordRef}
              value={password} onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleLogin(); }} />
          </div>
          <Button className="w-full" onClick={handleLogin} disabled={submitting}>
            {submitting ? 'Signing in...' : 'Sign in'}
          </Button>
        </CardContent>
        <CardFooter className="justify-center">
          <Button variant="link" onClick={() => navigate('/forgot-password')}>Forgot password?</Button>
        </CardFooter>
      </Card>
      <p className="mt-4 text-xs text-white/60">
        Powered by <a href="https://github.com/1111philo/plato" target="_blank" rel="noopener noreferrer" className="underline hover:text-white/80">plato</a>.
      </p>
    </main>
  );
}
