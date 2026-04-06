import { lazy, Suspense, useState, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext.jsx';
import AppShell from './components/AppShell.jsx';
import CoursesList from './pages/CoursesList.jsx';
import CourseChat from './pages/CourseChat.jsx';
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
const AdminCourses = lazy(() => import('./pages/admin/AdminCourses.jsx'));
const AdminAgents = lazy(() => import('./pages/admin/AdminAgents.jsx'));
const AdminSettings = lazy(() => import('./pages/admin/AdminSettings.jsx'));
const AdminContentUpdates = lazy(() => import('./pages/admin/AdminContentUpdates.jsx'));
const AdminCoursePreview = lazy(() => import('./pages/admin/AdminCoursePreview.jsx'));

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
          <Route path="courses" element={<Suspense fallback={<AdminFallback />}><AdminCourses /></Suspense>} />
          <Route path="courses/new" element={<Suspense fallback={<AdminFallback />}><AdminCourses /></Suspense>} />
          <Route path="courses/:courseId/preview" element={<Suspense fallback={<AdminFallback />}><AdminCoursePreview /></Suspense>} />
          <Route path="agents" element={<Suspense fallback={<AdminFallback />}><AdminAgents /></Suspense>} />
          <Route path="settings" element={<Suspense fallback={<AdminFallback />}><AdminSettings /></Suspense>} />
          <Route path="content-updates" element={<Suspense fallback={<AdminFallback />}><AdminContentUpdates /></Suspense>} />
        </Route>

        {/* Classroom routes — custom theme/branding applied here */}
        <Route path="/*" element={
          <RequireAuth>
            <BrandingProvider>
            <AppShell>
              <Routes>
                <Route path="/courses" element={<CoursesList />} />
                <Route path="/courses/create" element={<Navigate to="/courses" replace />} />
                <Route path="/courses/:courseGroupId" element={<CourseChat />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/" element={<Navigate to="/courses" replace />} />
                <Route path="*" element={<Navigate to="/courses" replace />} />
              </Routes>
            </AppShell>
            </BrandingProvider>
          </RequireAuth>
        } />
      </Routes>
    </>
  );
}
