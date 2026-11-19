/**
 * The look of a sign-in provider's button: an optional icon and an optional
 * background / text color pair, set by an admin in the provider's plugin
 * settings. Every provider's style goes through `buttonStyle` here before it
 * reaches the public `GET /v1/auth/sso/providers` payload, so a bad stored
 * value is dropped (the button falls back to the site's default look) rather
 * than served. docs/SSO.md, "Button style".
 *
 * Rules (mirrored for the admin panel in client/src/lib/sso.js):
 *   - Colors: both `#rrggbb`, and their WCAG contrast ratio at least 4.5:1.
 *     One color alone, or a failing pair, drops both.
 *   - Icon: a `data:image/(png|jpeg|webp);base64,…` URL of at most
 *     ICON_MAX_LENGTH characters whose first bytes are that format. No SVG
 *     (it can carry script) and no remote URL (tracking, mixed content).
 */
export const MIN_CONTRAST = 4.5;
/** The whole data URL, in characters (20 KB). */
export const ICON_MAX_LENGTH = 20 * 1024;

const HEX = /^#[0-9a-fA-F]{6}$/;
const ICON = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/;

export const isHexColor = (v) => typeof v === 'string' && HEX.test(v);

function luminance(hex) {
  const lin = (i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(1) + 0.7152 * lin(3) + 0.0722 * lin(5);
}

/** WCAG 2.x contrast ratio of two `#rrggbb` colors (1–21), or 0 when either isn't one. */
export function contrastRatio(a, b) {
  if (!isHexColor(a) || !isHexColor(b)) return 0;
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const SIGNATURES = {
  png: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  jpeg: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  webp: (b) => b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP',
};

/** A small PNG, JPEG, or WebP as a base64 data URL whose bytes match its type. */
export function isButtonIcon(v) {
  if (typeof v !== 'string' || v.length > ICON_MAX_LENGTH) return false;
  const m = ICON.exec(v);
  if (!m || m[2].length < 16) return false;
  return SIGNATURES[m[1]](Buffer.from(m[2].slice(0, 16), 'base64'));
}

/**
 * `{ background, color, icon }` → the same with only what passed, or null
 * when nothing did. Never throws.
 */
export function buttonStyle(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  if (contrastRatio(raw.background, raw.color) >= MIN_CONTRAST) {
    out.background = raw.background.toLowerCase();
    out.color = raw.color.toLowerCase();
  }
  if (isButtonIcon(raw.icon)) out.icon = raw.icon;
  return Object.keys(out).length ? out : null;
}
