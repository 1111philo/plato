import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useModal } from '../contexts/ModalContext.jsx';
import { useViewTransition } from '../hooks/useViewTransition.js';

export default function AppShell({ children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout, sessionExpired } = useAuth();
  const { show: showModal } = useModal();
  const animClass = useViewTransition();

  // Redirect to login when session expires
  useEffect(() => {
    if (sessionExpired) {
      logout().then(() => navigate('/login', { replace: true }));
    }
  }, [sessionExpired, logout, navigate]);

  const handleSignOut = () => {
    showModal(
      <ConfirmSignOut onConfirm={async () => {
        await logout();
        navigate('/login', { replace: true });
      }} />,
      'alertdialog',
      'Confirm sign out'
    );
  };

  const navTo = (path) => navigate(path);
  const currentNav = (path) => {
    if (path === '/courses') return location.pathname === '/courses' || location.pathname.startsWith('/courses/');
    return location.pathname === path;
  };

  return (
    <>
      <a href="#main-content" className="skip-link">Skip to main content</a>
      <header role="banner">
        <img src="/assets/icon-32.png" alt="" className="logo" />
        <span className="header-title">plato</span>
        <nav className="header-nav" aria-label="Main navigation">
          <button onClick={() => navTo('/courses')} aria-current={currentNav('/courses') ? 'page' : 'false'}>Courses</button>
          <button onClick={() => navTo('/settings')} aria-current={currentNav('/settings') ? 'page' : 'false'}>Settings</button>
          {user?.role === 'admin' && (
            <button onClick={() => navTo('/plato-admin')} aria-current={currentNav('/plato-admin') ? 'page' : 'false'}>Admin</button>
          )}
        </nav>
        <div className="header-spacer" />
        <div className="user-menu">
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button className="user-menu-btn" aria-label={`Account: ${user?.email || 'signed in'}`}>
                <span>{user?.email || 'Account'}</span>
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className="user-dropdown" sideOffset={6} align="end">
                <DropdownMenu.Label className="user-dropdown-email">{user?.email || ''}</DropdownMenu.Label>
                <DropdownMenu.Item className="user-dropdown-action danger" onSelect={handleSignOut}>
                  Sign Out
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </header>

      <main id="main-content" className={animClass} tabIndex={-1} aria-label="App content">
        {children}
      </main>

      <nav className="bottom-nav" aria-label="Main navigation">
        <button onClick={() => navTo('/courses')} aria-current={currentNav('/courses') ? 'page' : 'false'}>Courses</button>
        <button onClick={() => navTo('/settings')} aria-current={currentNav('/settings') ? 'page' : 'false'}>Settings</button>
      </nav>
    </>
  );
}

function ConfirmSignOut({ onConfirm }) {
  const { hide } = useModal();
  return (
    <>
      <h2>Sign Out?</h2>
      <p>You'll need to sign in again to access your courses.</p>
      <div className="action-bar">
        <button className="secondary-btn" onClick={hide}>Cancel</button>
        <button className="danger-btn" onClick={async () => { await onConfirm(); hide(); }}>Sign Out</button>
      </div>
    </>
  );
}
