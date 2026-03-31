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

  const isCurrent = (path) => {
    if (path === '/courses') return location.pathname === '/courses' || location.pathname.startsWith('/courses/');
    return location.pathname === path;
  };

  const navLinks = [
    { path: '/courses', label: 'Courses' },
    { path: '/settings', label: 'Settings' },
    ...(user?.role === 'admin' ? [{ path: '/plato', label: 'Admin' }] : []),
  ];

  // Classroom uses custom branding if set, otherwise falls back to plato logo
  const classroomLogo = branding?.logoBase64 || '/assets/logo-white.svg';
  const classroomAlt = branding?.logoAlt || 'plato';

  const headerBtnClass = 'text-inherit opacity-80 hover:opacity-100 hover:bg-white/10';

  return (
    <>
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:p-2 focus:bg-primary focus:text-primary-foreground">
        Skip to main content
      </a>

      <header
        className="px-4 py-2"
        style={{
          backgroundColor: 'var(--classroom-header-bg, var(--color-primary))',
          color: 'var(--classroom-header-text, var(--color-primary-foreground))',
        }}
        role="banner"
      >
        <div className="mx-auto max-w-5xl flex items-center gap-2">
          <img src={classroomLogo} alt={classroomAlt} className="h-8 w-auto" />
          <nav className="hidden md:flex items-center gap-1 ml-2" aria-label="Main navigation">
            {navLinks.map(({ path, label }) => (
              <Button key={path} variant="ghost" size="sm" className={headerBtnClass}
                onClick={() => navigate(path)} aria-current={isCurrent(path) ? 'page' : undefined}>
                {label}
              </Button>
            ))}
          </nav>
          <div className="flex-1" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className={headerBtnClass}
                aria-label={`Account: ${user?.email || 'signed in'}`}>
                {user?.email || 'Account'}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{user?.email || ''}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setSignOutOpen(true)}>
                Sign Out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <main id="main-content" className={`flex-1 min-h-0 overflow-y-auto ${animClass}`} tabIndex={-1}>
        {children}
      </main>

      <nav className="md:hidden border-t bg-background" aria-label="Main navigation">
        <div className="mx-auto max-w-5xl flex">
        {navLinks.filter(l => l.path !== '/plato').map(({ path, label }) => (
          <Button key={path} variant="ghost" size="sm" className="flex-1"
            onClick={() => navigate(path)} aria-current={isCurrent(path) ? 'page' : undefined}>
            {label}
          </Button>
        ))}
        </div>
      </nav>

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
