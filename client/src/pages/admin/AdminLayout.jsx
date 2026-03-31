import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext.jsx';

export default function AdminLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="admin-layout">
      <aside className="admin-sidebar" role="navigation" aria-label="Admin navigation">
        <div className="admin-sidebar-header">
          <strong>Plato Admin</strong>
        </div>
        <nav>
          <NavLink to="/plato-admin" end>Home</NavLink>
          <NavLink to="/plato-admin/participants">Participants</NavLink>
          <NavLink to="/plato-admin/courses">Courses</NavLink>
          <NavLink to="/plato-admin/prompts">Prompts</NavLink>
          <NavLink to="/plato-admin/theme">Theme</NavLink>
          <NavLink to="/plato-admin/settings">Settings</NavLink>
        </nav>
        <div className="admin-sidebar-footer">
          <div className="admin-user-email">{user?.email || ''}</div>
          <button className="link-btn" onClick={() => navigate('/courses')}>Back to Learn</button>
          <button className="link-btn" onClick={handleSignOut}>Sign Out</button>
        </div>
      </aside>
      <main className="admin-content">
        <Outlet />
      </main>
    </div>
  );
}
