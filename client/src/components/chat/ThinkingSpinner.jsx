export default function ThinkingSpinner({ text = 'Thinking...' }) {
  return (
    <div className="msg msg-thinking" role="status" aria-live="polite">
      <span className="loading-spinner-inline" aria-hidden="true" />
      <span> {text}</span>
    </div>
  );
}
