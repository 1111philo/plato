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

function RequireGuest({ children }) {
  const { loggedIn, loading } = useAuth();
  if (loading) return null;
  if (loggedIn) return <Navigate to="/courses" replace />;
  return children;
}

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
