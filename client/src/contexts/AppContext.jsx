import { createContext, useContext, useReducer, useEffect } from 'react';
import { getPreferences } from '../../js/storage.js';
import { loadLessons, invalidateLessonsCache } from '../../js/lessonOwner.js';
import * as sync from '../../js/sync.js';
import { useAuth } from './AuthContext.jsx';

const AppContext = createContext(null);

const initialState = {
  lessons: [],
  preferences: { name: '' },
  generating: null,
  loaded: false,
};

function reducer(state, action) {
  switch (action.type) {
    case 'INIT_DATA':
      return { ...state, ...action.payload, loaded: true };
    case 'SET_PREFERENCES':
      return { ...state, preferences: action.preferences };
    case 'SET_GENERATING':
      return { ...state, generating: action.generating };
    case 'REFRESH_LESSONS':
      return { ...state, lessons: action.lessons };
    default:
      return state;
  }
}

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const { loggedIn } = useAuth();

  useEffect(() => {
    if (!loggedIn) return;
    async function load() {
      try { await sync.loadAll(); } catch { /* offline or error */ }
      const lessons = await loadLessons();
      const preferences = await getPreferences();
      dispatch({ type: 'INIT_DATA', payload: { preferences, lessons } });
    }
    load();
  }, [loggedIn]);

  // Re-sync when the app returns to foreground
  useEffect(() => {
    if (!loggedIn) return;
    const handleVisibility = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        await sync.loadAll();
        invalidateLessonsCache();
        const preferences = await getPreferences();
        const lessons = await loadLessons();
        dispatch({ type: 'INIT_DATA', payload: { preferences, lessons } });
      } catch { /* offline or session expired */ }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [loggedIn]);

  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
