import { createContext, useContext, useState, useEffect } from 'react';

const BrandingContext = createContext(null);

/**
 * Provides classroom branding (theme colors + logo) to learner-facing UI.
 * Admin/plato UI is never affected — it always uses the default plato brand.
 */
export function BrandingProvider({ children }) {
  const [branding, setBranding] = useState({
    theme: null,
    logoBase64: null,
    logoAlt: 'plato',
    loaded: false,
  });

  useEffect(() => {
    fetch('/v1/branding')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data) {
          setBranding({ ...data, loaded: true });
          // Apply classroom theme CSS variables to :root
          if (data.theme) {
            for (const [key, value] of Object.entries(data.theme)) {
              document.documentElement.style.setProperty(key, value);
            }
          }
        } else {
          setBranding(prev => ({ ...prev, loaded: true }));
        }
      })
      .catch(() => setBranding(prev => ({ ...prev, loaded: true })));
  }, []);

  return (
    <BrandingContext.Provider value={branding}>
      {children}
    </BrandingContext.Provider>
  );
}

export function useBranding() {
  return useContext(BrandingContext);
}
