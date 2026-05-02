import { useRef, useEffect, useCallback } from 'react';

/**
 * Auto-expanding textarea input for lesson conversations.
 *
 * The textarea grows with content so learners never need to scroll inside
 * the input box (fixes reported scroll/click-registration bugs — #135).
 */
export default function LessonInput({ value, onChange, onSubmit, disabled, placeholder }) {
  const textareaRef = useRef(null);

  // Resize the textarea to fit its content whenever the value changes.
  // Setting height to 'auto' first forces the browser to recalculate
  // scrollHeight before we lock it in, preventing it from getting stuck.
  const resize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  useEffect(() => {
    resize();
  }, [value, resize]);

  const handleKeyDown = (e) => {
    // Submit on Enter (without Shift) — Shift+Enter inserts a newline
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!disabled && value.trim()) onSubmit();
    }
  };

  return (
    <textarea
      ref={textareaRef}
      value={value}
      onChange={(e) => { onChange(e.target.value); }}
      onKeyDown={handleKeyDown}
      disabled={disabled}
      placeholder={placeholder || 'Type your response…'}
      rows={1}
      style={{
        minHeight: '2.75rem',
        overflowY: 'hidden',
        resize: 'none',
      }}
      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
    />
  );
}
