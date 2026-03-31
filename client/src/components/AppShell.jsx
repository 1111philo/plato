import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useBranding } from '../contexts/BrandingContext.jsx';
import { useViewTransition } from '../hooks/useViewTransition.js';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader,
  AlertDialogTitle, AlertDialogDescription, AlertDialogFooter,
  AlertDialogAction, AlertDialogCancel,
} from '@/components/ui/alert-dialog';

export default function AppShell({ children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout, sessionExpired } = useAuth();
  const branding = useBranding();
  const animClass = useViewTransition();
  const [signOutOpen, setSignOutOpen] = useState(false);
  const isAdmin = user?.role === 'admin';

  useEffect(() => {
    if (sessionExpired) {
      logout().then(() => navigate('/login', { replace: true }));
    }
  }, [sessionExpired, logout, navigate]);

  const handleSignOut = async () => {
    await logout();
    navigate('/login', { replace: true });
    setSignOutOpen(false);
  };

  const classroomLogo = branding?.logoBase64 || '/assets/logo-white.svg';
  const classroomAlt = branding?.logoAlt || 'plato';

  return (
    <>
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:p-2 focus:bg-primary focus:text-primary-foreground">
        Skip to main content
      </a>

      {/* Admin bar — plato branding, quick links to dashboard */}
      {isAdmin && (
        <div className="px-4 py-1.5 text-xs text-white" style={{ backgroundColor: '#470d99' }}>
          <div className="mx-auto max-w-5xl flex items-center">
            <a href="/plato" onClick={e => { e.preventDefault(); navigate('/plato'); }} className="flex items-center gap-1.5 opacity-90 hover:opacity-100">
              <img src="/assets/logo-white.svg" alt="plato" className="h-3 w-auto" />
            </a>
            <div className="flex-1" />
            <button onClick={() => navigate('/plato')} className="flex items-center gap-1 opacity-70 hover:opacity-100 cursor-pointer bg-transparent border-none text-inherit text-xs">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
              Dashboard
            </button>
          </div>
        </div>
      )}

      {/* Classroom header — custom branding */}
      <header
        className="px-4 py-2"
        style={{
          backgroundColor: 'var(--classroom-header-bg, var(--color-primary))',
          color: 'var(--classroom-header-text, var(--color-primary-foreground))',
        }}
        role="banner"
      >
        <div className="mx-auto max-w-5xl flex items-center gap-2">
          <a href="/courses" onClick={e => { e.preventDefault(); navigate('/courses'); }} className="shrink-0">
            <img src={classroomLogo} alt={classroomAlt} className="h-8 w-auto" />
          </a>
          <div className="flex-1" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="text-inherit opacity-80 hover:opacity-100 hover:bg-white/10 cursor-pointer bg-transparent border-none rounded-md px-3 py-1.5 text-sm font-medium"
                aria-label={`Account: ${user?.email || 'signed in'}`}>
                {user?.name || user?.email || 'Account'}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{user?.email || ''}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => navigate('/settings')}>
                Settings
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={() => setSignOutOpen(true)}>
                Sign Out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <main id="main-content" className={`flex-1 min-h-0 overflow-y-auto bg-stone-100 dark:bg-stone-900 ${animClass}`} tabIndex={-1}>
        {children}
      </main>

      <AlertDialog open={signOutOpen} onOpenChange={setSignOutOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sign Out?</AlertDialogTitle>
            <AlertDialogDescription>
              You'll need to sign in again to access your courses.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive/10 text-destructive hover:bg-destructive/20"
              onClick={handleSignOut}
            >
              Sign Out
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
