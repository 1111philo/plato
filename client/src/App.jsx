import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext.jsx';
import AppShell from './components/AppShell.jsx';
import CoursesList from './pages/CoursesList.jsx';
import CourseChat from './pages/CourseChat.jsx';
import CourseCreate from './pages/CourseCreate.jsx';
import Settings from './pages/Settings.jsx';
import Login from './pages/Login.jsx';
import Signup from './pages/Signup.jsx';
import ForgotPassword from './pages/ForgotPassword.jsx';
import ResetPassword from './pages/ResetPassword.jsx';
import ScreenReaderAnnounce from './components/ScreenReaderAnnounce.jsx';

// Lazy-load admin bundle
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
    return <main style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 }}>
      <span className="loading-spinner-inline" aria-hidden="true" />
    </main>;
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
  <main style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 }}>
    <span className="loading-spinner-inline" aria-hidden="true" />
  </main>
);

export default function App() {
  const { loading } = useAuth();

  if (loading) {
    return <main style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 }}>
      <span className="loading-spinner-inline" aria-hidden="true" />
    </main>;
  }

  return (
    <>
      <ScreenReaderAnnounce />
      <Routes>
        {/* Public auth routes */}
        <Route path="/login" element={<RequireGuest><Login /></RequireGuest>} />
        <Route path="/signup" element={<RequireGuest><Signup /></RequireGuest>} />
        <Route path="/forgot-password" element={<RequireGuest><ForgotPassword /></RequireGuest>} />
        <Route path="/reset-password" element={<RequireGuest><ResetPassword /></RequireGuest>} />

        {/* Admin routes */}
        <Route path="/plato-admin/*" element={
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

        {/* Protected app routes */}
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
