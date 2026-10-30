import { useState, useEffect } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { can, isTester } from '../../lib/permissions.js';

// `permission`: who sees the link (lib/permissions.js). Educators don't get
// Customizer or Plugins; testers see everything read-only.
const NAV_LINKS = [
  { to: '/plato', label: 'Home', end: true, permission: 'admin.access' },
  { to: '/plato/lessons', label: 'Lessons', permission: 'content.read' },
  { to: '/plato/users', label: 'Users', permission: 'users.read' },
  { to: '/plato/customizer', label: 'Customizer', permission: 'kb.read' },
  { to: '/plato/plugins', label: 'Plugins', permission: 'plugins.read' },
];

const WIDE_PAGES = new Set(['/plato/users', '/plato/lessons']);

function NavItems({ onClick, user }) {
  return NAV_LINKS.filter((l) => can(user, l.permission)).map(({ to, label, end }) => (
    <NavLink
      key={to}
      to={to}
      end={end}
      onClick={onClick}
      className={({ isActive }) =>
        `block px-3 py-2 rounded-md text-sm transition-colors whitespace-nowrap ${
          isActive
            ? 'bg-primary-foreground/20 font-medium'
            : 'hover:bg-primary-foreground/10'
        }`
      }
    >
      {label}
    </NavLink>
  ));
}

export default function AdminLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [version, setVersion] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    fetch('/v1/version').then(r => r.json()).then(d => setVersion(d.version)).catch(() => {});
  }, []);

  // Close menu on route change
  useEffect(() => { setMenuOpen(false); }, [location.pathname]);

  const handleSignOut = async () => {
    setMenuOpen(false);
    await logout();
    navigate('/login', { replace: true });
  };

  // List pages hold wide tables, so they get the full width; forms and
  // editors keep the readable max-width.
  const wide = WIDE_PAGES.has(location.pathname.replace(/\/$/, ''));

  return (
    <div className="flex flex-col md:flex-row min-h-screen">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:p-2 focus:bg-primary focus:text-primary-foreground">
        Skip to main content
      </a>
      {/* Mobile: top bar with hamburger */}
      <header className="md:hidden bg-primary text-primary-foreground flex items-center justify-between px-4 py-3">
        <a href="/plato" onClick={e => { e.preventDefault(); navigate('/plato'); }}>
          <img src="/assets/logo-white.svg" alt="plato" className="h-6 w-auto" />
        </a>
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="bg-transparent border-none cursor-pointer text-primary-foreground p-1"
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={menuOpen}
        >
          {menuOpen ? (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          ) : (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          )}
        </button>
      </header>

      {/* Mobile: slide-out drawer */}
      {menuOpen && (
        <>
          <div
            className="md:hidden fixed inset-0 bg-black/40 z-40"
            onClick={() => setMenuOpen(false)}
            aria-hidden="true"
          />
          <div className="md:hidden fixed top-0 left-0 w-64 h-full bg-primary text-primary-foreground z-50 flex flex-col animate-in slide-in-from-left duration-200">
            <div className="flex items-center justify-between px-4 py-3">
              <img src="/assets/logo-white.svg" alt="plato" className="h-6 w-auto" />
              <button
                onClick={() => setMenuOpen(false)}
                className="bg-transparent border-none cursor-pointer text-primary-foreground p-1"
                aria-label="Close menu"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <nav className="flex flex-col flex-1 gap-0.5 px-2" aria-label="Admin navigation">
              <NavItems user={user} onClick={() => setMenuOpen(false)} />
            </nav>

            <div className="flex flex-col gap-2 px-4 py-3 mt-auto">
              <Button
                variant="secondary"
                className="w-full"
                onClick={() => { setMenuOpen(false); navigate('/lessons'); }}
              >
                Visit Classroom
              </Button>
              <Separator className="bg-primary-foreground/20" />
              <span className="text-xs truncate opacity-80">{user?.email || ''}</span>
              <Button
                variant="link"
                size="sm"
                className="justify-start p-0 h-auto text-primary-foreground/80 hover:text-primary-foreground"
                onClick={handleSignOut}
              >
                Sign Out
              </Button>
              {version && (
                <>
                  <Separator className="bg-primary-foreground/20" />
                  <a
                    href="https://github.com/1111philo/plato"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs opacity-60 hover:opacity-100 transition-opacity"
                  >
                    plato {version}
                  </a>
                </>
              )}
            </div>
          </div>
        </>
      )}

      {/* Desktop: fixed sidebar */}
      <aside
        className="hidden md:flex md:w-56 md:h-screen md:fixed md:top-0 md:left-0 bg-primary text-primary-foreground md:flex-col shrink-0"
        aria-label="Admin sidebar"
      >
        <div className="px-4 py-4">
          <img src="/assets/logo-white.svg" alt="plato" className="h-6 w-auto" />
        </div>

        <nav className="flex flex-col flex-1 gap-0.5 px-2" aria-label="Admin navigation">
          <NavItems user={user} />
        </nav>

        <div className="flex flex-col gap-2 px-4 py-3 mt-auto">
          <Button
            variant="secondary"
            className="w-full"
            onClick={() => navigate('/lessons')}
          >
            Visit Classroom
          </Button>
          <Separator className="bg-primary-foreground/20" />
          <span className="text-xs truncate opacity-80">{user?.email || ''}</span>
          <Button
            variant="link"
            size="sm"
            className="justify-start p-0 h-auto text-primary-foreground/80 hover:text-primary-foreground"
            onClick={handleSignOut}
          >
            Sign Out
          </Button>
          {version && (
            <>
              <Separator className="bg-primary-foreground/20" />
              <a
                href="https://github.com/1111philo/plato"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs opacity-60 hover:opacity-100 transition-opacity"
              >
                plato {version}
              </a>
            </>
          )}
        </div>
      </aside>

      <main id="main-content" tabIndex={-1} className="flex-1 min-w-0 p-6 md:ml-56">
        <div className={`${wide ? 'max-w-none' : 'max-w-4xl'} pb-4`}>
          {isTester(user) && (
            <p className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
              <strong>Tester (read-only):</strong> you can open everything, but changes aren’t saved.
            </p>
          )}
          <Outlet />
        </div>
      </main>
    </div>
  );
}
