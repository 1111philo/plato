import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const ROUTE_NAMES = {
  '/lessons': 'Lessons',
  '/settings': 'Settings',
  '/onboarding': 'Welcome',
};

export default function ScreenReaderAnnounce() {
  const location = useLocation();
  const [message, setMessage] = useState('');

  useEffect(() => {
    const path = location.pathname;
    let name = ROUTE_NAMES[path];
    if (!name && path.startsWith('/lessons/create')) name = 'Create Lesson';
    else if (!name && path.startsWith('/lessons/')) name = 'Lesson';

    if (name) {
      setMessage(`Navigated to ${name}`);
      document.title = `${name} — plato`;
    }
  }, [location.pathname]);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
    >
      {message}
    </div>
  );
}
