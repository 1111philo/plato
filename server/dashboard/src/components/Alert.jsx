import { useEffect } from 'react';

export default function Alert({ message, type, raw, onDismiss }) {
  useEffect(() => {
    if (type === 'success' && !raw && onDismiss) {
      const timer = setTimeout(onDismiss, 3000);
      return () => clearTimeout(timer);
    }
  }, [message, type, raw, onDismiss]);

  if (!message) return null;

  return (
    <div
      className={`alert alert-${type}`}
      role="alert"
      dangerouslySetInnerHTML={raw ? { __html: message } : undefined}
    >
      {raw ? undefined : message}
    </div>
  );
}
