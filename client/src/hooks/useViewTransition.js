import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';

const DEPTH = {
  onboarding: 0,
  lessons: 1,
  units: 2,
  unit: 3,
  work: 1,
  'work-detail': 2,
  settings: 1,
};

function getDepth(pathname) {
  const segment = pathname.split('/').filter(Boolean)[0] || 'lessons';
  return DEPTH[segment] ?? 1;
}

export function useViewTransition() {
  const location = useLocation();
  const prevRef = useRef(location.pathname);
  const [animClass, setAnimClass] = useState('');

  useEffect(() => {
    const prevDepth = getDepth(prevRef.current);
    const newDepth = getDepth(location.pathname);

    if (newDepth > prevDepth) setAnimClass('view-slide-left');
    else if (newDepth < prevDepth) setAnimClass('view-slide-right');
    else setAnimClass('view-fade-up');

    prevRef.current = location.pathname;

    const timer = setTimeout(() => setAnimClass(''), 300);
    return () => clearTimeout(timer);
  }, [location.pathname]);

  return animClass;
}
