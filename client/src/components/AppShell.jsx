import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useModal } from '../contexts/ModalContext.jsx';
import { useViewTransition } from '../hooks/useViewTransition.js';
import LoginModal from './modals/LoginModal.jsx';

export default function AppShell({ children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { loggedIn, user, logout, sessionExpired } = useAuth();
  const { show: showModal } = useModal();
  const animClass = useViewTransition();
  const isOnboarding = location.pathname.startsWith('/onboarding');

  // Prompt re-login when session expires on another device
  useEffect(() => {
    if (sessionExpired) {
      showModal(
        <LoginModal message="Your session expired. Please sign in again to continue syncing." />,
      );
    }
  }, [sessionExpired, showModal]);

  const handleUserMenuClick = () => {
    if (!loggedIn) {
      showModal(<LoginModal />);
    }
  };

  const handleSignOut = () => {
    showModal(
      <ConfirmSignOut onConfirm={async () => {
        await logout();
        navigate('/onboarding');
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
      {!isOnboarding && (
        <header role="banner">
          <img src="assets/icon-32.png" alt="1111" className="logo" />
          <span className="header-title">Learn</span>
          <nav className="header-nav" aria-label="Main navigation">
            <button onClick={() => navTo('/courses')} aria-current={currentNav('/courses') ? 'page' : 'false'}>Courses</button>
            <button onClick={() => navTo('/settings')} aria-current={currentNav('/settings') ? 'page' : 'false'}>Settings</button>
          </nav>
          <div className="header-spacer" />
          <div className="user-menu">
            {loggedIn ? (
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
            ) : (
              <button className="user-menu-btn" aria-label="Login" onClick={handleUserMenuClick}>
                <span>Login</span>
              </button>
            )}
          </div>
        </header>
      )}

      <main id="main-content" className={animClass} tabIndex={-1} aria-label="App content">
        {children}
      </main>

      {!isOnboarding && (
        <nav className="bottom-nav" aria-label="Main navigation">
          <button onClick={() => navTo('/courses')} aria-current={currentNav('/courses') ? 'page' : 'false'}>Courses</button>
          <button onClick={() => navTo('/settings')} aria-current={currentNav('/settings') ? 'page' : 'false'}>Settings</button>
        </nav>
      )}
    </>
  );
}

function ConfirmSignOut({ onConfirm }) {
  const { hide } = useModal();
  return (
    <>
      <h2>Sign Out?</h2>
      <p>This will clear all local data and return you to the welcome screen.</p>
      <div className="action-bar">
        <button className="secondary-btn" onClick={hide}>Cancel</button>
        <button className="danger-btn" onClick={async () => { await onConfirm(); hide(); }}>Sign Out</button>
      </div>
    </>
  );
}
