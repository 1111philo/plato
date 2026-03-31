import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './auth';
import Layout from './components/Layout';
import Login from './pages/Login';
import Signup from './pages/Signup';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import Profile from './pages/Profile';
import Home from './pages/admin/Home';
import Participants from './pages/admin/Participants';
import ParticipantDetail from './pages/admin/ParticipantDetail';
import Settings from './pages/admin/Settings';

function RequireAuth({ children }) {
  const { auth } = useAuth();
  if (!auth) return <Navigate to="/" replace />;
  return children;
}

function RequireAdmin({ children }) {
  const { auth } = useAuth();
  if (!auth) return <Navigate to="/" replace />;
  if (auth.user.role !== 'admin') return <Navigate to="/profile" replace />;
  return children;
}

function RootRedirect() {
  const { auth } = useAuth();

  // Check real browser query params (before hash) for invite/reset tokens.
  // The original app uses ?token= and ?reset= on the base URL, not inside the hash.
  const browserParams = new URLSearchParams(window.location.search);
  const token = browserParams.get('token');
  const reset = browserParams.get('reset');

  if (reset) return <Navigate to={`/reset-password?reset=${encodeURIComponent(reset)}`} replace />;
  if (token) return <Navigate to={`/signup?token=${encodeURIComponent(token)}`} replace />;
  if (!auth) return <Login />;
  if (auth.user.role === 'admin') return <Navigate to="/home" replace />;
  return <Navigate to="/profile" replace />;
}

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<RootRedirect />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route
          path="/home"
          element={
            <RequireAdmin>
              <Home />
            </RequireAdmin>
          }
        />
        <Route
          path="/participants"
          element={
            <RequireAdmin>
              <Participants />
            </RequireAdmin>
          }
        />
        <Route
          path="/participants/:userId"
          element={
            <RequireAdmin>
              <ParticipantDetail />
            </RequireAdmin>
          }
        />
        <Route
          path="/settings"
          element={
            <RequireAdmin>
              <Settings />
            </RequireAdmin>
          }
        />
        <Route
          path="/profile"
          element={
            <RequireAuth>
              <Profile />
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
