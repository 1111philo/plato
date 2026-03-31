import { lazy, Suspense, useState, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext.jsx';
import AppShell from './components/AppShell.jsx';
import CoursesList from './pages/CoursesList.jsx';
import CourseChat from './pages/CourseChat.jsx';
import CourseCreate from './pages/CourseCreate.jsx';
import Settings from './pages/Settings.jsx';
import Login from './pages/Login.jsx';
import Signup from './pages/Signup.jsx';
import Setup from './pages/Setup.jsx';
import ForgotPassword from './pages/ForgotPassword.jsx';
import ResetPassword from './pages/ResetPassword.jsx';
import ScreenReaderAnnounce from './components/ScreenReaderAnnounce.jsx';

const AdminLayout = lazy(() => import('./pages/admin/AdminLayout.jsx'));
const AdminHome = lazy(() => import('./pages/admin/AdminHome.jsx'));
const AdminParticipants = lazy(() => import('./pages/admin/AdminParticipants.jsx'));
const AdminCourses = lazy(() => import('./pages/admin/AdminCourses.jsx'));
const AdminPrompts = lazy(() => import('./pages/admin/AdminPrompts.jsx'));
const AdminTheme = lazy(() => import('./pages/admin/AdminTheme.jsx'));
const AdminSettings = lazy(() => import('./pages/admin/AdminSettings.jsx'));

function RequireAuth({ children }) {
  const { loggedIn, loading } = useAuth();
  if (loading) {
    return (
      <main className="min-h-dvh flex items-center justify-center">
        <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" aria-hidden="true" />
      </main>
    );
  }
  if (!loggedIn) return <Navigate to="/login" replace />;
  return children;
}

function RequireAdmin({ children }) {
  const { user } = useAuth();
  if (user?.role !== 'admin') return <Navigate to="/courses" replace />;
  return children;
}

function RequireGuest({ children }) {
  const { loggedIn, loading } = useAuth();
  if (loading) return null;
  if (loggedIn) return <Navigate to="/courses" replace />;
  return children;
}

const AdminFallback = () => (
  <main className="min-h-dvh flex items-center justify-center">
    <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" aria-hidden="true" />
  </main>
);

export default function App() {
  const { loading } = useAuth();
  const [needsSetup, setNeedsSetup] = useState(null);

  useEffect(() => {
    fetch('/v1/auth/setup-status')
      .then(r => r.json())
      .then(d => setNeedsSetup(d.needsSetup))
      .catch(() => setNeedsSetup(false));
  }, []);

  if (loading || needsSetup === null) {
    return (
      <main className="min-h-dvh flex items-center justify-center">
        <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" aria-hidden="true" />
      </main>
    );
  }

  if (needsSetup) {
    return (
      <>
        <ScreenReaderAnnounce />
        <Routes>
          <Route path="*" element={<Setup />} />
        </Routes>
      </>
    );
  }

  return (
    <>
      <ScreenReaderAnnounce />
      <Routes>
        <Route path="/login" element={<RequireGuest><Login /></RequireGuest>} />
        <Route path="/signup" element={<RequireGuest><Signup /></RequireGuest>} />
        <Route path="/forgot-password" element={<RequireGuest><ForgotPassword /></RequireGuest>} />
        <Route path="/reset-password" element={<RequireGuest><ResetPassword /></RequireGuest>} />

        <Route path="/plato/*" element={
          <RequireAuth>
            <RequireAdmin>
              <Suspense fallback={<AdminFallback />}>
                <AdminLayout />
              </Suspense>
            </RequireAdmin>
          </RequireAuth>
        }>
          <Route index element={<Suspense fallback={<AdminFallback />}><AdminHome /></Suspense>} />
          <Route path="participants" element={<Suspense fallback={<AdminFallback />}><AdminParticipants /></Suspense>} />
          <Route path="courses" element={<Suspense fallback={<AdminFallback />}><AdminCourses /></Suspense>} />
          <Route path="prompts" element={<Suspense fallback={<AdminFallback />}><AdminPrompts /></Suspense>} />
          <Route path="theme" element={<Suspense fallback={<AdminFallback />}><AdminTheme /></Suspense>} />
          <Route path="settings" element={<Suspense fallback={<AdminFallback />}><AdminSettings /></Suspense>} />
        </Route>

        <Route path="/*" element={
          <RequireAuth>
            <AppShell>
              <Routes>
                <Route path="/courses" element={<CoursesList />} />
                <Route path="/courses/create" element={<CourseCreate />} />
                <Route path="/courses/:courseGroupId" element={<CourseChat />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/" element={<Navigate to="/courses" replace />} />
                <Route path="*" element={<Navigate to="/courses" replace />} />
              </Routes>
            </AppShell>
          </RequireAuth>
        } />
      </Routes>
    </>
  );
}
