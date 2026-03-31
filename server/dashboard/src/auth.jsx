import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { setSessionExpiredCallback } from './api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [auth, setAuthState] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('ls_auth') || 'null');
    } catch {
      return null;
    }
  });

  const setAuth = useCallback((data) => {
    if (data) {
      const authData = {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        user: data.user,
      };
      setAuthState(authData);
      localStorage.setItem('ls_auth', JSON.stringify(authData));
    } else {
      setAuthState(null);
      localStorage.removeItem('ls_auth');
    }
  }, []);

  const updateUser = useCallback((updates) => {
    setAuthState((prev) => {
      if (!prev) return prev;
      const next = { ...prev, user: { ...prev.user, ...updates } };
      localStorage.setItem('ls_auth', JSON.stringify(next));
      return next;
    });
  }, []);

  const logout = useCallback(() => {
    if (auth?.refreshToken) {
      fetch('/v1/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: auth.refreshToken }),
      }).catch(() => {});
    }
    setAuth(null);
  }, [auth?.refreshToken, setAuth]);

  useEffect(() => {
    setSessionExpiredCallback(() => {
      setAuthState(null);
    });
  }, []);

  return (
    <AuthContext.Provider value={{ auth, setAuth, updateUser, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
