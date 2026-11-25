/**
 * The product's name is always **plato**: bold and lowercase, wherever a
 * person reads it (Blake, 2026-11-25: "vital to the branding"). This finds
 * the name in text, and not where it's part of an identifier, a path or an
 * address (`plato-users`, `/plato/lessons`, `plato.courses`,
 * `1111philo/plato`), so only the word a person reads is styled.
 *
 * - `brandHtml(html)`: for HTML plato built itself (renderMd, emails): wraps
 *   the name in text, never inside a tag or an attribute.
 * - `brandParts(text)`: for React: the text split into strings and
 *   `{ brand: true }` parts (components/Brand.jsx renders them).
 */
export const BRAND = 'plato';

// "plato", "plato's", "plato." at a sentence end; not "plato-users",
// "/plato", "plato.courses", "plato_auth", "@plato" or an existing **plato**.
export const BRAND_RE = /(?<![\p{L}\p{N}_/.\-@*#`])plato(?![\p{L}\p{N}_\-/@*`]|\.[\p{L}\p{N}])/gu;

/** HTML with the name bold in its text. Tags (and their attributes) are left alone, and so is text already in <strong> or <code>. */
export function brandHtml(html) {
  const parts = String(html ?? '').split(/(<[^>]+>)/);
  let skip = 0;
  return parts.map((p) => {
    if (p.startsWith('<')) {
      if (/^<(strong|b|code|pre)\b/i.test(p)) skip++;
      else if (/^<\/(strong|b|code|pre)>/i.test(p)) skip = Math.max(0, skip - 1);
      return p;
    }
    return skip ? p : p.replace(BRAND_RE, '<strong>plato</strong>');
  }).join('');
}

/** Text as strings and brand parts, for rendering in React. */
export function brandParts(text) {
  const s = String(text ?? '');
  const out = [];
  let last = 0;
  for (const m of s.matchAll(BRAND_RE)) {
    if (m.index > last) out.push(s.slice(last, m.index));
    out.push({ brand: true });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}
