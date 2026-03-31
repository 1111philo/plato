import { useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useApp } from './contexts/AppContext.jsx';
import { useAuth } from './contexts/AuthContext.jsx';
import AppShell from './components/AppShell.jsx';
import OnboardingFlow from './pages/onboarding/OnboardingFlow.jsx';
import CoursesList from './pages/CoursesList.jsx';
import CourseChat from './pages/CourseChat.jsx';
import CourseCreate from './pages/CourseCreate.jsx';
import Settings from './pages/Settings.jsx';
import ScreenReaderAnnounce from './components/ScreenReaderAnnounce.jsx';
import { getOnboardingComplete, saveOnboardingComplete, getLearnerProfile } from '../js/storage.js';

export default function App() {
  const { state } = useApp();
  const { loggedIn, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!state.loaded || authLoading) return;
    if (window.location.hash.includes('/onboarding')) return;
    (async () => {
      const done = await getOnboardingComplete();
      if (!done && loggedIn) {
        const profile = await getLearnerProfile();
        if (profile) {
          await saveOnboardingComplete();
        } else {
          navigate('/onboarding', { replace: true });
        }
      } else if (!done && !loggedIn) {
        navigate('/onboarding', { replace: true });
      }
    })();
  }, [state.loaded, authLoading]);

  if (!state.loaded || authLoading) {
    return <main style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 }}>
      <span className="loading-spinner-inline" aria-hidden="true" />
    </main>;
  }

  return (
    <AppShell>
      <ScreenReaderAnnounce />
      <Routes>
        <Route path="/onboarding/*" element={<OnboardingFlow />} />
        <Route path="/courses" element={<CoursesList />} />
        <Route path="/courses/create" element={<CourseCreate />} />
        <Route path="/courses/:courseGroupId" element={<CourseChat />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/" element={<Navigate to="/courses" replace />} />
        <Route path="*" element={<Navigate to="/courses" replace />} />
      </Routes>
    </AppShell>
  );
}
