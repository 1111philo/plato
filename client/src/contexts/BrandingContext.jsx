import { createContext, useContext, useState, useEffect } from 'react';

const BrandingContext = createContext(null);

/**
 * Provides classroom branding (theme colors + logo) to learner-facing UI.
 * The plato dashboard is never affected — it always uses the default plato brand.
 *
 * Theme keys (hex colors):
 *   headerBg, headerText, accent, background, surface, text, border
 */
export function BrandingProvider({ children }) {
  const [branding, setBranding] = useState({
    theme: null,
    logoBase64: null,
    logoAlt: '',
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

  // Build inline style overrides from the theme for the classroom wrapper
  const classroomStyle = {};
  if (branding.theme) {
    const t = branding.theme;
    if (t.headerBg) classroomStyle['--classroom-header-bg'] = t.headerBg;
    if (t.headerText) classroomStyle['--classroom-header-text'] = t.headerText;
    if (t.accent) classroomStyle['--classroom-accent'] = t.accent;
    if (t.background) classroomStyle['--classroom-bg'] = t.background;
    if (t.surface) classroomStyle['--classroom-surface'] = t.surface;
    if (t.text) classroomStyle['--classroom-text'] = t.text;
    if (t.border) classroomStyle['--classroom-border'] = t.border;
  }

  return (
    <BrandingContext.Provider value={branding}>
      <div style={classroomStyle} className="flex flex-col flex-1 min-h-0">
        {children}
      </div>
    </BrandingContext.Provider>
  );
}

export function useBranding() {
  return useContext(BrandingContext);
}
