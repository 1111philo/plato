import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
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

  const navTo = (path) => navigate(path);
  const currentNav = (path) => {
    if (path === '/courses') return location.pathname === '/courses' || location.pathname.startsWith('/courses/');
    return location.pathname === path;
  };

  return (
    <>
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:p-2 focus:bg-primary focus:text-primary-foreground">
        Skip to main content
      </a>

      <header role="banner" className="flex items-center gap-2 bg-primary px-4 py-2 text-primary-foreground">
        <img src="/assets/logo-white.svg" alt="plato" className="h-5 w-auto" />
        <nav className="hidden md:flex items-center gap-1 ml-2" aria-label="Main navigation">
          <Button
            variant="ghost"
            size="sm"
            className="text-primary-foreground/80 hover:text-primary-foreground hover:bg-primary-foreground/10"
            onClick={() => navTo('/courses')}
            aria-current={currentNav('/courses') ? 'page' : 'false'}
          >
            Courses
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-primary-foreground/80 hover:text-primary-foreground hover:bg-primary-foreground/10"
            onClick={() => navTo('/settings')}
            aria-current={currentNav('/settings') ? 'page' : 'false'}
          >
            Settings
          </Button>
          {user?.role === 'admin' && (
            <Button
              variant="ghost"
              size="sm"
              className="text-primary-foreground/80 hover:text-primary-foreground hover:bg-primary-foreground/10"
              onClick={() => navTo('/plato-admin')}
              aria-current={currentNav('/plato-admin') ? 'page' : 'false'}
            >
              Admin
            </Button>
          )}
        </nav>
        <div className="flex-1" />
        <div className="hidden md:block">
          <DropdownMenu>
            <DropdownMenuTrigger>
              <Button
                variant="ghost"
                size="sm"
                className="text-primary-foreground/80 hover:text-primary-foreground hover:bg-primary-foreground/10"
                aria-label={`Account: ${user?.email || 'signed in'}`}
              >
                {user?.email || 'Account'}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={6}>
              <DropdownMenuLabel>{user?.email || ''}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setSignOutOpen(true)}>
                Sign Out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <main id="main-content" className={animClass} tabIndex={-1} aria-label="App content">
        {children}
      </main>

      <nav className="flex md:hidden items-center justify-around border-t border-border bg-background py-2" aria-label="Main navigation">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navTo('/courses')}
          aria-current={currentNav('/courses') ? 'page' : 'false'}
        >
          Courses
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navTo('/settings')}
          aria-current={currentNav('/settings') ? 'page' : 'false'}
        >
          Settings
        </Button>
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
