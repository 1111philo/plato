import { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import Logo from './Logo';
import LoadingBar from './LoadingBar';
import { setLoadingCallback } from '../api';

export default function Layout({ children }) {
  const { auth, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const triggerRef = useRef(null);

  useEffect(() => {
    setLoadingCallback(setLoading);
  }, []);

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    if (triggerRef.current) {
      triggerRef.current.focus();
    }
  }, []);

  useEffect(() => {
    function handleClickOutside(e) {
      if (menuOpen && menuRef.current && !menuRef.current.contains(e.target)) {
        closeMenu();
      }
    }
    function handleKeyDown(e) {
      if (e.key === 'Escape' && menuOpen) {
        closeMenu();
      }
    }
    document.addEventListener('click', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('click', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen, closeMenu]);

  const showHeader = !!auth;
  const isAdmin = auth?.user?.role === 'admin';
  const path = location.pathname;

  const isHomeActive = path === '/' || path === '/home';
  const isParticipantsActive = path === '/participants' || path.startsWith('/participants/');
  const isSettingsActive = path === '/settings';

  function handleMyProfile() {
    setMenuOpen(false);
    navigate('/profile');
  }

  function handleLogout() {
    setMenuOpen(false);
    logout();
    navigate('/');
  }

  function toggleMenu() {
    setMenuOpen((prev) => {
      const next = !prev;
      if (next) {
        setTimeout(() => {
          if (menuRef.current) {
            const first = menuRef.current.querySelector('button');
            if (first) first.focus();
          }
        }, 0);
      }
      return next;
    });
  }

  return (
    <>
      <LoadingBar visible={loading} />
      {showHeader && (
        <header className="header" role="banner">
          <Logo size={28} />
          <span className="header-title">Learn</span>
          {isAdmin && (
            <nav className="header-nav" aria-label="Main navigation">
              <Link
                className={`header-nav-btn${isHomeActive ? ' active' : ''}`}
                aria-current={isHomeActive ? 'page' : undefined}
                to="/home"
              >
                Home
              </Link>
              <Link
                className={`header-nav-btn${isParticipantsActive ? ' active' : ''}`}
                aria-current={isParticipantsActive ? 'page' : undefined}
                to="/participants"
              >
                Participants
              </Link>
              <Link
                className={`header-nav-btn${isSettingsActive ? ' active' : ''}`}
                aria-current={isSettingsActive ? 'page' : undefined}
                to="/settings"
              >
                Settings
              </Link>
            </nav>
          )}
          <div className="header-right">
            <div className="user-menu" ref={menuRef}>
              <button
                className="user-menu-btn"
                ref={triggerRef}
                onClick={toggleMenu}
                aria-haspopup="true"
                aria-expanded={menuOpen}
              >
                {auth.user.name || auth.user.email} &#9662;
              </button>
              <div
                className={`user-dropdown${menuOpen ? ' open' : ''}`}
                role="menu"
                aria-label="User menu"
              >
                <button role="menuitem" onClick={handleMyProfile}>
                  My Profile
                </button>
                <button role="menuitem" onClick={handleLogout}>
                  Log out
                </button>
              </div>
            </div>
          </div>
        </header>
      )}
      <main className="container" role="main">
        {children}
      </main>
    </>
  );
}
