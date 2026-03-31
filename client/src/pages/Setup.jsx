import { useState, useEffect } from 'react';
import PasswordField from '../components/PasswordField.jsx';
import { saveAuthTokens, saveAuthUser } from '../../js/storage.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card, CardHeader, CardTitle, CardDescription, CardContent,
} from '@/components/ui/card';

export default function Setup() {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

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
      // Save tokens and reload — this resets needsSetup and logs in
      await saveAuthTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken });
      await saveAuthUser(data.user);
      window.location.href = '/plato';
    } catch (e) {
      setError(e.message || 'Setup failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-dvh flex flex-col items-center justify-center bg-muted p-4">
      <img src="/assets/logo.svg" alt="plato" className="h-10 mb-6" />
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">Let's Start...</CardTitle>
          <CardDescription>Create your admin account to get started.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="bg-destructive/10 text-destructive border border-destructive/20 rounded-lg p-3 text-sm" role="alert">
              {error}
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="setup-name">Name</Label>
            <Input
              id="setup-name"
              type="text"
              placeholder="Your name"
              autoComplete="name"
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="setup-email">Email</Label>
            <Input
              id="setup-email"
              type="email"
              placeholder="admin@example.com"
              autoComplete="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="setup-password">Password</Label>
            <PasswordField
              id="setup-password"
              placeholder="At least 8 characters"
              autoComplete="new-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="setup-confirm">Confirm password</Label>
            <PasswordField
              id="setup-confirm"
              autoComplete="new-password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSetup(); }}
            />
          </div>
          <Button className="w-full" onClick={handleSetup} disabled={submitting}>
            {submitting ? 'Creating...' : 'Create admin account'}
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
