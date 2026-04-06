import { lazy, Suspense, useState, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext.jsx';
import AppShell from './components/AppShell.jsx';
import LessonsList from './pages/LessonsList.jsx';
import LessonChat from './pages/LessonChat.jsx';
import Settings from './pages/Settings.jsx';
import Login from './pages/Login.jsx';
import Signup from './pages/Signup.jsx';
import Setup from './pages/Setup.jsx';
import ForgotPassword from './pages/ForgotPassword.jsx';
import ResetPassword from './pages/ResetPassword.jsx';
import ScreenReaderAnnounce from './components/ScreenReaderAnnounce.jsx';
import { BrandingProvider } from './contexts/BrandingContext.jsx';

const AdminLayout = lazy(() => import('./pages/admin/AdminLayout.jsx'));
const AdminHome = lazy(() => import('./pages/admin/AdminHome.jsx'));
const AdminUsers = lazy(() => import('./pages/admin/AdminUsers.jsx'));
const AdminLessons = lazy(() => import('./pages/admin/AdminLessons.jsx'));
const AdminCustomizer = lazy(() => import('./pages/admin/AdminCustomizer.jsx'));
const AdminIntegrations = lazy(() => import('./pages/admin/AdminIntegrations.jsx'));
const AdminLessonPreview = lazy(() => import('./pages/admin/AdminLessonPreview.jsx'));
const AdminKBSetup = lazy(() => import('./pages/admin/AdminKBSetup.jsx'));

function RequireAuth({ children }) {
  const { loggedIn, loading } = useAuth();
  if (loading) {
    return (
      <main className="min-h-dvh flex items-center justify-center" role="status" aria-live="polite">
        <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" aria-hidden="true" />
        <span className="sr-only">Loading...</span>
      </main>
    );
  }
  if (!loggedIn) return <Navigate to="/login" replace />;
  return children;
}

function RequireAdmin({ children }) {
  const { user } = useAuth();
  if (user?.role !== 'admin') return <Navigate to="/lessons" replace />;
  return children;
}

function RequireGuest({ children }) {
  const { loggedIn, loading } = useAuth();
  if (loading) return null;
  if (loggedIn) return <Navigate to="/lessons" replace />;
  return children;
}

const AdminFallback = () => (
  <main className="min-h-dvh flex items-center justify-center" role="status" aria-live="polite">
    <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" aria-hidden="true" />
    <span className="sr-only">Loading...</span>
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
      <main className="min-h-dvh flex items-center justify-center" role="status" aria-live="polite">
        <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" aria-hidden="true" />
        <span className="sr-only">Loading...</span>
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
          <Route path="users" element={<Suspense fallback={<AdminFallback />}><AdminUsers /></Suspense>} />
          <Route path="lessons" element={<Suspense fallback={<AdminFallback />}><AdminLessons /></Suspense>} />
          <Route path="lessons/new" element={<Suspense fallback={<AdminFallback />}><AdminLessons /></Suspense>} />
          <Route path="lessons/:lessonId/preview" element={<Suspense fallback={<AdminFallback />}><AdminLessonPreview /></Suspense>} />
          <Route path="customizer" element={<Suspense fallback={<AdminFallback />}><AdminCustomizer /></Suspense>} />
          <Route path="customizer/knowledge" element={<Suspense fallback={<AdminFallback />}><AdminCustomizer /></Suspense>} />
          <Route path="customizer/knowledge/edit" element={<Suspense fallback={<AdminFallback />}><AdminCustomizer /></Suspense>} />
          <Route path="integrations" element={<Suspense fallback={<AdminFallback />}><AdminIntegrations /></Suspense>} />
          <Route path="setup-kb" element={<Suspense fallback={<AdminFallback />}><AdminKBSetup /></Suspense>} />
        </Route>

        {/* Classroom routes — custom theme/branding applied here */}
        <Route path="/*" element={
          <RequireAuth>
            <BrandingProvider>
            <AppShell>
              <Routes>
                <Route path="/lessons" element={<LessonsList />} />
                <Route path="/lessons/create" element={<Navigate to="/lessons" replace />} />
                <Route path="/lessons/:lessonGroupId" element={<LessonChat />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/" element={<Navigate to="/lessons" replace />} />
                <Route path="*" element={<Navigate to="/lessons" replace />} />
              </Routes>
            </AppShell>
            </BrandingProvider>
          </RequireAuth>
        } />
      </Routes>
    </>
  );
}
