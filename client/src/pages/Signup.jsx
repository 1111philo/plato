import { useState, useRef, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import PasswordField from '../components/PasswordField.jsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter,
} from '@/components/ui/card';

export default function Signup() {
  const [name, setName] = useState('');
  const [group, setGroup] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [groups, setGroups] = useState([]);
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const confirmRef = useRef(null);

  const [branding, setBranding] = useState(null);

  useEffect(() => {
    document.title = 'Create account — plato';
    fetch('/v1/branding').then(r => r.ok ? r.json() : null).then(setBranding).catch(() => {});
    fetch('/v1/groups')
      .then(r => r.json())
      .then(d => setGroups(d.userGroups || []))
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
          userGroup: userGroup || undefined,
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
    <main className="min-h-dvh flex flex-col items-center justify-center p-4" style={{ backgroundColor: branding?.theme?.primary || '#8b1a1a' }}>
      <img src={branding?.logoBase64 || '/assets/academy-logo.png'} alt={branding?.logoAlt || "Plato's Academy"} className="h-16 w-16 mb-6 rounded-lg object-contain" />
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">Create your account</CardTitle>
          <CardDescription>You've been invited to join plato.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="bg-destructive/10 text-destructive border border-destructive/20 rounded-lg p-3 text-sm" role="alert">
              {error}
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="signup-name">Name</Label>
            <Input
              id="signup-name"
              type="text"
              placeholder="Your name"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          {groups.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="signup-group">
                User Group <span className="text-muted-foreground text-xs">(optional)</span>
              </Label>
              <select
                id="signup-group"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={group}
                onChange={(e) => setGroup(e.target.value)}
              >
                <option value="">Select group</option>
                {groups.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="signup-password">Password</Label>
            <PasswordField
              id="signup-password"
              placeholder="At least 8 characters"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="signup-confirm">Confirm password</Label>
            <PasswordField
              id="signup-confirm"
              autoComplete="new-password"
              inputRef={confirmRef}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSignup(); }}
            />
          </div>
          <Button className="w-full" onClick={handleSignup} disabled={submitting}>
            {submitting ? 'Creating...' : 'Create account'}
          </Button>
        </CardContent>
        <CardFooter className="justify-center">
          <Button variant="link" onClick={() => navigate('/login')}>
            Already have an account? Sign in
          </Button>
        </CardFooter>
      </Card>
      <p className="mt-4 text-xs text-white/60">
        Powered by <a href="https://github.com/1111philo/plato" target="_blank" rel="noopener" className="underline hover:text-white/80">plato</a>
      </p>
    </main>
  );
}
