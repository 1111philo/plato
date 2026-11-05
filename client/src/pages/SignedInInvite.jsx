import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import usePublicBranding from '../hooks/usePublicBranding.js';
import { Button } from '@/components/ui/button';
import {
  Card, CardHeader, CardTitle, CardDescription, CardFooter,
} from '@/components/ui/card';

/**
 * An invite link (/signup?token=…) opened while signed in. Says who's signed
 * in instead of quietly showing that account's classroom: sign out and
 * continue to the signup form, or go back to the lessons.
 */
export default function SignedInInvite() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const branding = usePublicBranding('Invite');
  const who = user?.email || user?.username || 'another account';

  async function signOutAndContinue() {
    const here = `${window.location.pathname}${window.location.search}`;
    await logout();
    navigate(here, { replace: true });
  }

  if (!branding) return null;

  return (
    <main className="min-h-dvh shrink-0 flex flex-col items-center justify-start py-12 p-4" style={{ backgroundColor: branding.primary }}>
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>
            <h1 className="text-2xl">This invite is for a new account</h1>
          </CardTitle>
          <CardDescription>
            You&rsquo;re signed in as <strong>{who}</strong>. To use this invite, sign out first.
          </CardDescription>
        </CardHeader>
        <CardFooter className="flex flex-wrap gap-2">
          <Button onClick={signOutAndContinue}>Sign out and continue</Button>
          <Button variant="outline" onClick={() => navigate('/lessons')}>Go to my lessons</Button>
        </CardFooter>
      </Card>
    </main>
  );
}
