import { brandParts } from '../lib/brand.js';

/** The product's name, as it's always shown: **plato**, bold and lowercase. */
export function Brand() {
  return <strong className="font-bold">plato</strong>;
}

/**
 * Text with every mention of the product's name shown as **plato**
 * (lib/brand.js). Use it wherever plato's own copy is rendered as text.
 * Anything that isn't a string is rendered as it is.
 */
export function BrandText({ children }) {
  if (typeof children !== 'string') return children ?? null;
  const parts = brandParts(children);
  if (parts.length === 1 && typeof parts[0] === 'string') return parts[0];
  return parts.map((p, i) => (typeof p === 'string' ? p : <Brand key={i} />));
}
