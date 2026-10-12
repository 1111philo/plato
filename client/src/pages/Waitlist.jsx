import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import usePublicBranding from '../hooks/usePublicBranding.js';
import CustomFieldInput from '../components/CustomFieldInput.jsx';
import { missingRequired } from '../lib/userFields.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter,
} from '@/components/ui/card';

// Join the wait list (#363). Asks for what signup asks, minus the password;
// an admin invites the person later from Admin → Users.
export default function Waitlist() {
  const [open, setOpen] = useState(null);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [group, setGroup] = useState('');
  const [groups, setGroups] = useState([]);
  const [userFields, setUserFields] = useState([]);
  const [fieldValues, setFieldValues] = useState({});
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [website, setWebsite] = useState(''); // honeypot — see below
  const navigate = useNavigate();
  const branding = usePublicBranding('Join the wait list');

  useEffect(() => {
    fetch('/v1/waitlist')
      .then(r => (r.ok ? r.json() : null))
      .then(d => setOpen(!!d?.open))
      .catch(() => setOpen(false));
    fetch('/v1/groups')
      .then(r => r.json())
      .then(d => setGroups(d.userGroups || []))
      .catch(() => {});
    fetch('/v1/user-fields')
      .then(r => r.json())
      .then(d => setUserFields(d.userFields || []))
      .catch(() => {});
  }, []);

  async function handleSubmit() {
    if (!name.trim() || !email.trim()) {
      setError('Name and email are required.');
      return;
    }
    const missing = missingRequired(userFields, fieldValues);
    if (missing.length) {
      const labels = userFields.filter(f => missing.includes(f.id)).map(f => f.label);
      setError(`Please fill in: ${labels.join(', ')}.`);
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/v1/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          userGroup: group || undefined,
          customFields: userFields.length ? fieldValues : undefined,
          website: website || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not join the wait list');
      setDone(true);
    } catch (e) {
      setError(e.message || 'Could not join the wait list');
    } finally {
      setSubmitting(false);
    }
  }

  if (!branding || open === null) return null;

  let body;
  if (done) {
    body = (
      <CardContent>
        <p role="status">You are on the wait list. We will email you when you are invited.</p>
      </CardContent>
    );
  } else if (!open) {
    body = (
      <CardContent>
        <p>The wait list is closed right now.</p>
      </CardContent>
    );
  } else {
    body = (
      <CardContent className="space-y-4">
        {error && (
          <div className="bg-destructive/10 text-destructive border border-destructive/20 rounded-lg p-3 text-sm" role="alert">
            {error}
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="waitlist-name">Name</Label>
          <Input id="waitlist-name" type="text" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="waitlist-email">Email</Label>
          <Input id="waitlist-email" type="email" autoComplete="email" placeholder="your.email@example.com"
            value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        {groups.length > 0 && (
          <div className="space-y-2">
            <Label htmlFor="waitlist-group">
              User Group <span className="text-muted-foreground text-xs">(optional)</span>
            </Label>
            <select
              id="waitlist-group"
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={group}
              onChange={(e) => setGroup(e.target.value)}
            >
              <option value="">Select group</option>
              {groups.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
        )}
        {userFields.map(f => (
          <CustomFieldInput
            key={f.id}
            field={f}
            idPrefix="waitlist-field"
            value={fieldValues[f.id]}
            onChange={(v) => setFieldValues(prev => ({ ...prev, [f.id]: v }))}
          />
        ))}
        {/* Honeypot: off-screen, hidden from assistive tech, and out of the tab
            order, so only bots fill it. The server silently drops those. */}
        <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
          <label htmlFor="waitlist-website">Website</label>
          <input id="waitlist-website" type="text" name="website" tabIndex={-1} autoComplete="off"
            value={website} onChange={(e) => setWebsite(e.target.value)} />
        </div>
        <Button className="w-full" onClick={handleSubmit} disabled={submitting}>
          {submitting ? 'Sending...' : 'Join the wait list'}
        </Button>
      </CardContent>
    );
  }

  return (
    <main className="min-h-dvh flex flex-col items-center justify-start py-12 p-4" style={{ backgroundColor: branding.primary }}>
      {branding.logo ? (<img src={branding.logo} alt={branding.classroomName} className="h-16 w-16 mb-6 rounded-lg object-contain" />) : (<h1 className="text-2xl font-bold text-white mb-6">{branding.classroomName}</h1>)}
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">Join the wait list</CardTitle>
          <CardDescription>Ask to join {branding.classroomName}.</CardDescription>
        </CardHeader>
        {body}
        <CardFooter className="justify-center">
          <Button variant="link" onClick={() => navigate('/login')}>
            Already have an account? Sign in
          </Button>
        </CardFooter>
      </Card>
      <p className="mt-4 text-xs text-white/60">
        Powered by <a href="https://github.com/1111philo/plato" target="_blank" rel="noopener noreferrer" className="underline hover:text-white/80">plato</a>.
      </p>
    </main>
  );
}
