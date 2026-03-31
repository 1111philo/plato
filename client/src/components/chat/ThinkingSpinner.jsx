export default function ThinkingSpinner({ text = 'Thinking...' }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground" role="status" aria-live="polite">
      <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" aria-hidden="true" />
      <span>{text}</span>
    </div>
  );
}
