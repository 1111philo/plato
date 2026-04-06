/** Shared branding utilities — used by BrandingContext and public auth pages. */

/** Relative luminance (0=black, 1=white). */
export function luminance(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const lin = (c) => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Pick white or dark text for readable contrast on a background. */
export function contrastText(bgHex) {
  return luminance(bgHex) < 0.4 ? '#ffffff' : '#1a1a1a';
}

/** Convert hex to oklch string. */
export function hexToOklch(hex) {
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

/** Build CSS var overrides from theme primary/accent. */
export function buildThemeVars(theme) {
  const vars = {};
  if (!theme) return vars;
  const { primary, accent } = theme;
  if (primary) {
    vars['--classroom-header-bg'] = primary;
    vars['--classroom-header-text'] = contrastText(primary);
    vars['--primary'] = hexToOklch(primary);
    vars['--primary-foreground'] = hexToOklch(contrastText(primary));
    vars['--ring'] = hexToOklch(primary);
  }
  if (accent) {
    const accentColor = accent !== primary ? accent : primary;
    vars['--ring'] = hexToOklch(accentColor);
  }
  return vars;
}

/**
 * Generate a favicon: classroom logo (or text initial) on a rounded-rect background.
 * Returns a data URL suitable for <link rel="icon">.
 * @param {string|null} logoBase64 - logo image data URL, or null for text-based
 * @param {string} primaryColor - background color
 * @param {string} classroomName - used for text initial when no logo image
 */
export function generateFavicon(logoBase64, primaryColor, classroomName = '') {
  return new Promise((resolve) => {
    const size = 32;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // Rounded rect background
    const radius = 6;
    ctx.beginPath();
    ctx.moveTo(radius, 0);
    ctx.lineTo(size - radius, 0);
    ctx.quadraticCurveTo(size, 0, size, radius);
    ctx.lineTo(size, size - radius);
    ctx.quadraticCurveTo(size, size, size - radius, size);
    ctx.lineTo(radius, size);
    ctx.quadraticCurveTo(0, size, 0, size - radius);
    ctx.lineTo(0, radius);
    ctx.quadraticCurveTo(0, 0, radius, 0);
    ctx.closePath();
    ctx.fillStyle = primaryColor;
    ctx.fill();

    if (logoBase64) {
      // Draw logo image centered with padding
      const img = new Image();
      img.onload = () => {
        const pad = 4;
        const area = size - pad * 2;
        const scale = Math.min(area / img.width, area / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => resolve(null);
      img.src = logoBase64;
    } else {
      // Draw text initial
      const initial = (classroomName || 'P').charAt(0).toUpperCase();
      const textColor = lum(primaryColor) < 0.4 ? '#ffffff' : '#1a1a1a';
      ctx.fillStyle = textColor;
      ctx.font = 'bold 20px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(initial, size / 2, size / 2 + 1);
      resolve(canvas.toDataURL('image/png'));
    }
  });
}

function lum(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const lin = (c) => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Set (or restore) the favicon link element. Returns a cleanup function. */
export function setFavicon(dataUrl) {
  const link = document.querySelector("link[rel='icon']") || document.createElement('link');
  const original = link.href;
  link.rel = 'icon';
  link.type = 'image/png';
  link.href = dataUrl;
  document.head.appendChild(link);
  return () => { link.href = original; };
}
