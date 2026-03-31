import { createContext, useContext, useState, useEffect } from 'react';
import { useAuth } from './AuthContext.jsx';

const BrandingContext = createContext(null);

/** Relative luminance (0=black, 1=white). */
function luminance(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const lin = (c) => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Pick white or dark text for readable contrast on a background. */
function contrastText(bgHex) {
  return luminance(bgHex) < 0.4 ? '#ffffff' : '#1a1a1a';
}

/** Convert hex to oklch string. */
function hexToOklch(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const lin = (c) => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  const lr = lin(r), lg = lin(g), lb = lin(b);
  const l_ = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m_ = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s_ = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;
  const l = Math.cbrt(l_), m = Math.cbrt(m_), s = Math.cbrt(s_);
  const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  const bOk = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  const C = Math.sqrt(a * a + bOk * bOk);
  const h = (Math.atan2(bOk, a) * 180 / Math.PI + 360) % 360;
  return `oklch(${L.toFixed(3)} ${C.toFixed(3)} ${h.toFixed(1)})`;
}

/**
 * Provides classroom branding to learner-facing UI.
 * The plato dashboard is never affected.
 *
 * Only two colors are needed: primary and accent.
 * Everything else (foreground, header text, hover states) is derived automatically.
 */
export function BrandingProvider({ children }) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

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

  // Swap favicon to classroom logo (regular users only — admins keep plato favicon)
  useEffect(() => {
    if (!branding.logoBase64 || isAdmin) return;
    const link = document.querySelector("link[rel='icon']") || document.createElement('link');
    const original = link.href;
    link.rel = 'icon';
    link.href = branding.logoBase64;
    document.head.appendChild(link);
    return () => { link.href = original; };
  }, [branding.logoBase64]);

  // Derive full theme from primary + accent
  const classroomStyle = {};
  if (branding.theme) {
    const { primary, accent } = branding.theme;
    if (primary) {
      classroomStyle['--classroom-header-bg'] = primary;
      classroomStyle['--classroom-header-text'] = contrastText(primary);
      classroomStyle['--primary'] = hexToOklch(primary);
      classroomStyle['--primary-foreground'] = hexToOklch(contrastText(primary));
      classroomStyle['--ring'] = hexToOklch(primary);
    }
    if (accent) {
      // Use accent for links, focus rings — but only if different from primary
      const accentColor = accent !== primary ? accent : primary;
      classroomStyle['--ring'] = hexToOklch(accentColor);
    }
  }

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
