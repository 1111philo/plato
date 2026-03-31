import { createContext, useContext, useReducer, useEffect } from 'react';
import { getPreferences } from '../../js/storage.js';
import { loadCourses, invalidateCoursesCache } from '../../js/courseOwner.js';
import * as sync from '../../js/sync.js';
import * as auth from '../../js/auth.js';

const AppContext = createContext(null);

const initialState = {
  courses: [],
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
    case 'REFRESH_COURSES':
      return { ...state, courses: action.courses };
    default:
      return state;
  }
}

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    async function load() {
      const courses = await loadCourses();

      if (await auth.isLoggedIn()) {
        try { await sync.loadAll(); } catch { /* offline */ }
      }

      const preferences = await getPreferences();
      dispatch({ type: 'INIT_DATA', payload: { preferences, courses } });
    }
    load();
  }, []);

  // Re-sync when the app returns to foreground (multi-device: pick up changes from other devices)
  useEffect(() => {
    const handleVisibility = async () => {
      if (document.visibilityState !== 'visible') return;
      if (!await auth.isLoggedIn()) return;
      try {
        await sync.loadAll();
        invalidateCoursesCache();
        const preferences = await getPreferences();
        const courses = await loadCourses();
        dispatch({ type: 'INIT_DATA', payload: { preferences, courses } });
      } catch { /* offline or session expired — handled elsewhere */ }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

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
