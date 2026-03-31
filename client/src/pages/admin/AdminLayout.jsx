import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';

const NAV_LINKS = [
  { to: '/plato', label: 'Home', end: true },
  { to: '/plato/participants', label: 'Participants' },
  { to: '/plato/courses', label: 'Courses' },
  { to: '/plato/prompts', label: 'Prompts' },
  { to: '/plato/theme', label: 'Theme' },
  { to: '/plato/settings', label: 'Settings' },
];

export default function AdminLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="flex flex-col md:flex-row min-h-screen">
      {/* Sidebar — vertical on md+, horizontal strip on mobile */}
      <aside
        className="w-full md:w-56 bg-primary text-primary-foreground flex md:flex-col shrink-0"
        role="navigation"
        aria-label="Admin navigation"
      >
        {/* Header */}
        <div className="px-4 py-3 font-semibold text-lg hidden md:block">
          Plato Admin
        </div>

        {/* Nav links — horizontal scroll on mobile, vertical on md+ */}
        <nav className="flex md:flex-col flex-1 overflow-x-auto md:overflow-x-visible gap-0.5 px-2 md:px-2">
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

        {/* Footer */}
        <div className="hidden md:flex flex-col gap-1 px-4 py-3 mt-auto">
          <Separator className="mb-2 bg-primary-foreground/20" />
          <span className="text-xs truncate opacity-80">{user?.email || ''}</span>
          <Button
            variant="link"
            size="sm"
            className="justify-start p-0 h-auto text-primary-foreground/80 hover:text-primary-foreground"
            onClick={() => navigate('/courses')}
          >
            Back to Learn
          </Button>
          <Button
            variant="link"
            size="sm"
            className="justify-start p-0 h-auto text-primary-foreground/80 hover:text-primary-foreground"
            onClick={handleSignOut}
          >
            Sign Out
          </Button>
        </div>
      </aside>

      {/* Content area */}
      <main className="flex-1 p-6 overflow-y-auto max-w-4xl">
        <Outlet />
      </main>
    </div>
  );
}
