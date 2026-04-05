import { useState, useEffect } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';

const NAV_LINKS = [
  { to: '/plato', label: 'Home', end: true },
  { to: '/plato/users', label: 'Users' },
  { to: '/plato/courses', label: 'Courses' },
  { to: '/plato/agents', label: 'Agents & Knowledge' },
  { to: '/plato/settings', label: 'Settings' },
];

export default function AdminLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [version, setVersion] = useState(null);

  useEffect(() => {
    fetch('/v1/version').then(r => r.json()).then(d => setVersion(d.version)).catch(() => {});
  }, []);

  const handleSignOut = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="flex flex-col md:flex-row min-h-screen">
      {/* Mobile: top header + horizontal nav tabs */}
      <header className="md:hidden bg-primary text-primary-foreground">
        <div className="flex items-center justify-between px-4 py-3">
          <a href="/plato" onClick={e => { e.preventDefault(); navigate('/plato'); }}>
            <img src="/assets/logo-white.svg" alt="plato" className="h-6 w-auto" />
          </a>
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate('/courses')}
              className="text-xs text-primary-foreground/80 hover:text-primary-foreground bg-transparent border border-primary-foreground/30 rounded px-2 py-1 cursor-pointer transition-colors"
            >
              Classroom
            </button>
            <button
              onClick={handleSignOut}
              className="text-xs text-primary-foreground/60 hover:text-primary-foreground bg-transparent border-none cursor-pointer transition-colors"
            >
              Sign Out
            </button>
          </div>
        </div>
        <nav className="flex overflow-x-auto gap-0.5 px-2 pb-2" aria-label="Admin navigation">
          {NAV_LINKS.map(({ to, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `block px-3 py-1.5 rounded-md text-sm transition-colors whitespace-nowrap ${
                  isActive
                    ? 'bg-primary-foreground/20 font-medium'
                    : 'hover:bg-primary-foreground/10'
                }`
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
      </header>

      {/* Desktop: fixed sidebar */}
      <aside
        className="hidden md:flex md:w-56 md:h-screen md:fixed md:top-0 md:left-0 bg-primary text-primary-foreground md:flex-col shrink-0"
        aria-label="Admin sidebar"
      >
        <div className="px-4 py-4">
          <img src="/assets/logo-white.svg" alt="plato" className="h-6 w-auto" />
        </div>

        <nav className="flex flex-col flex-1 gap-0.5 px-2" aria-label="Admin navigation">
          {NAV_LINKS.map(({ to, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
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
          ))}
        </nav>

        <div className="flex flex-col gap-2 px-4 py-3 mt-auto">
          <Button
            variant="secondary"
            className="w-full"
            onClick={() => navigate('/courses')}
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

      <main className="flex-1 p-6 md:ml-56">
        <div className="max-w-4xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
