import { createContext, useContext, useState, useEffect } from 'react';
import { useAuth } from './AuthContext.jsx';
import { buildThemeVars, generateFavicon, setFavicon } from '../lib/branding.js';

const BrandingContext = createContext(null);

/**
 * Provides classroom branding to learner-facing UI.
 * The plato dashboard is never affected.
 */
export function BrandingProvider({ children }) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [branding, setBranding] = useState({
    theme: null,
    logoBase64: null,
    classroomName: '',
    loaded: false,
  });

  useEffect(() => {
    fetch('/v1/branding')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data) {
          setBranding({ ...data, loaded: true });
        } else {
          setBranding(prev => ({ ...prev, loaded: true }));
        }
      })
      .catch(() => setBranding(prev => ({ ...prev, loaded: true })));
  }, []);

  // Generate and set favicon — only when classroom has a logo image; otherwise use plato default
  useEffect(() => {
    if (!branding.logoBase64 || !branding.theme?.primary || isAdmin) return;
    let cancelled = false;
    let restoreFn;
    generateFavicon(branding.logoBase64, branding.theme.primary).then(dataUrl => {
      if (dataUrl && !cancelled) restoreFn = setFavicon(dataUrl);
    });
    return () => { cancelled = true; restoreFn?.(); };
  }, [branding.logoBase64, branding.theme?.primary, isAdmin]);

  const classroomStyle = buildThemeVars(branding.theme);

  if (!branding.loaded) return null;

  return (
    <BrandingContext.Provider value={branding}>
      <div style={classroomStyle} className="flex flex-col flex-1">
        {children}
      </div>
    </BrandingContext.Provider>
  );
}

export function useBranding() {
  return useContext(BrandingContext);
}
