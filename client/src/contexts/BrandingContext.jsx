import { createContext, useContext, useState, useEffect } from 'react';

const BrandingContext = createContext(null);

/** Convert hex (#rrggbb) to an oklch() string for Tailwind CSS variable overrides. */
function hexToOklch(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  // sRGB to linear
  const lin = (c) => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  const lr = lin(r), lg = lin(g), lb = lin(b);
  // Linear sRGB to OKLab
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
 * Provides classroom branding (theme colors + logo) to learner-facing UI.
 * The plato dashboard is never affected.
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

  // Set favicon to classroom logo if available
  useEffect(() => {
    if (!branding.logoBase64) return;
    const link = document.querySelector("link[rel='icon']") || document.createElement('link');
    const original = link.href;
    link.rel = 'icon';
    link.href = branding.logoBase64;
    document.head.appendChild(link);
    return () => { link.href = original; }; // restore plato favicon on unmount
  }, [branding.logoBase64]);

  // Override Tailwind CSS variables with classroom theme colors
  const classroomStyle = {};
  if (branding.theme) {
    const t = branding.theme;
    // Header colors (read by AppShell via var())
    if (t.headerBg) classroomStyle['--classroom-header-bg'] = t.headerBg;
    if (t.headerText) classroomStyle['--classroom-header-text'] = t.headerText;
    // Override Tailwind/shadcn semantic tokens so all components pick up the theme
    if (t.accent) {
      const oklch = hexToOklch(t.accent);
      classroomStyle['--primary'] = oklch;
      classroomStyle['--ring'] = oklch;
    }
    if (t.background) classroomStyle['--background'] = hexToOklch(t.background);
    if (t.surface) classroomStyle['--muted'] = hexToOklch(t.surface);
    if (t.text) {
      classroomStyle['--foreground'] = hexToOklch(t.text);
      classroomStyle['--card-foreground'] = hexToOklch(t.text);
    }
    if (t.border) {
      classroomStyle['--border'] = hexToOklch(t.border);
      classroomStyle['--input'] = hexToOklch(t.border);
    }
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
