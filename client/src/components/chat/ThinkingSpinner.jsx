/**
 * Shown while plato works on a reply (it's checked before it's shown, so it
 * can take a few seconds): "Thinking…" with a light sweeping across it
 * (index.css .thinking-shimmer), set apart from the conversation's text.
 * Screen readers hear it once, as plato thinking; the animated word is
 * hidden from them. Still with reduced motion.
 */
export default function ThinkingSpinner({ text = 'Thinking…' }) {
  return (
    <div className="px-3 py-2" role="status" aria-live="polite">
      <span className="sr-only">{text === 'Thinking…' ? 'plato is thinking' : text}</span>
      <span aria-hidden="true" className="thinking-shimmer inline-block text-sm font-medium tracking-wide">{text}</span>
    </div>
  );
}
