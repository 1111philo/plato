import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const ROUTE_NAMES = {
  '/courses': 'Courses',
  '/settings': 'Settings',
  '/onboarding': 'Welcome',
};

export default function ScreenReaderAnnounce() {
  const location = useLocation();
  const [message, setMessage] = useState('');

  useEffect(() => {
    const path = location.pathname;
    let name = ROUTE_NAMES[path];
    if (!name && path.startsWith('/courses/create')) name = 'Create Course';
    else if (!name && path.startsWith('/courses/')) name = 'Course';

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
      style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap' }}
    >
      {message}
    </div>
  );
}
