/**
 * Turn an uploaded image into the sign-in button's icon: a PNG (or WebP, if
 * the PNG is too big) data URL downscaled to fit 64 × 64 and within the size
 * cap the server enforces. Redrawing on a canvas also drops metadata.
 * Rejects with a message to show.
 */
import { isSsoIcon, SSO_ICON_PIXELS } from '@/lib/sso.js';

const TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_FILE_BYTES = 5 * 1024 * 1024;

export async function fileToIcon(file) {
  // No SVG: it can carry script, and the server refuses it.
  if (!TYPES.includes(file.type)) throw new Error('Use a PNG, JPEG, or WebP image.');
  if (file.size > MAX_FILE_BYTES) throw new Error('That file is too large. Use an image under 5 MB.');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Couldn’t read that image.'));
      el.src = url;
    });
    const scale = Math.min(1, SSO_ICON_PIXELS / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    // PNG first (lossless, keeps transparency); WebP if that's over the cap.
    for (const [type, quality] of [['image/png'], ['image/webp', 0.9]]) {
      const out = canvas.toDataURL(type, quality);
      if (isSsoIcon(out)) return out;
    }
    throw new Error('That image is too detailed for an icon. Try a simpler one.');
  } finally {
    URL.revokeObjectURL(url);
  }
}
