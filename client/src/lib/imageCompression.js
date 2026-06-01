/**
 * Image compression for pasted / uploaded screenshots.
 *
 * Each screenshot is persisted as its own `screenshot:*` sync-data record,
 * and DynamoDB caps a single item at 400 KB. An uncompressed laptop
 * screenshot easily exceeds that — when it did, the write failed silently
 * and the learner's conversation was lost (issues #191, #193). Compressing
 * on the way in keeps every screenshot record comfortably under the limit.
 */

// Target size for the encoded data URL body. Well under DynamoDB's 400 KB
// item limit, leaving headroom for the record's other attributes.
const DEFAULT_MAX_BYTES = 350 * 1024;

/**
 * Estimate the decoded byte size of a base64 data URL from its string length.
 * Base64 encodes 3 bytes per 4 characters. Pure — safe to unit test.
 */
export function estimateDataUrlBytes(dataUrl) {
  if (typeof dataUrl !== 'string') return 0;
  const comma = dataUrl.indexOf(',');
  const body = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  return Math.floor((body.length * 3) / 4);
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image decode failed'));
    img.src = src;
  });
}

function encodeJpeg(img, maxEdge, quality) {
  const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', quality);
}

/**
 * Downscale + re-encode an image data URL so it fits inside one sync-data
 * record. Iteratively drops quality, then dimensions, until the result is
 * under `maxBytes`. Always resolves, never throws. Returns `null` when the
 * image can't be brought under `maxBytes` (or a decode failure leaves an
 * oversized original) so the caller can warn the user upfront instead of
 * letting the server reject the write with a 413.
 */
export async function compressImageDataUrl(dataUrl, { maxBytes = DEFAULT_MAX_BYTES } = {}) {
  try {
    if (typeof document === 'undefined' || typeof Image === 'undefined') return dataUrl;
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return dataUrl;
    // Already small enough — don't re-encode (avoids needless quality loss).
    if (estimateDataUrlBytes(dataUrl) <= maxBytes) return dataUrl;

    const img = await loadImage(dataUrl);
    let edge = 1600;
    let quality = 0.82;
    let out = encodeJpeg(img, edge, quality);

    for (let attempt = 0; attempt < 8 && estimateDataUrlBytes(out) > maxBytes; attempt++) {
      if (quality > 0.4) {
        quality -= 0.15;
      } else {
        edge = Math.round(edge * 0.75);
        quality = 0.6;
      }
      out = encodeJpeg(img, edge, quality);
    }

    // If compression succeeded, return the result. If it's still too large after
    // all attempts, return null so the caller can surface an error to the user
    // instead of silently writing data that will hit DynamoDB's 400 KB item limit.
    return estimateDataUrlBytes(out) <= maxBytes ? out : null;
  } catch {
    // Decode failed (corrupt file, unsupported format). Fall back to the
    // original — but only if it already fits. An oversized original must
    // return null too, so the caller surfaces the "too large" warning
    // upfront instead of letting the server reject it with a 413.
    return estimateDataUrlBytes(dataUrl) <= maxBytes ? dataUrl : null;
  }
}
