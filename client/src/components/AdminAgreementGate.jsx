import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { acceptAdminAgreement } from '../../js/auth.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';

/**
 * Blocks the admin dashboard until the admin accepts the user agreement (#407).
 * Shown once per admin on first dashboard access; existing admins see it on
 * next login. Fails open: if the check errors, the dashboard renders (a
 * legal prompt must never lock admins out).
 */
export default function AdminAgreementGate({ children }) {
  const { user, refreshUser } = useAuth();
  const [loading, setLoading] = useState(true);
  const [accepted, setAccepted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const headingRef = useRef(null);

  useEffect(() => {
    if (user?.role !== 'admin') {
      setLoading(false);
      return;
    }
    if (user.adminAgreementAcceptedAt) {
      setLoading(false);
      return;
    }
    setLoading(false);
  }, [user]);

  const blocking = !loading && user?.role === 'admin' && !user.adminAgreementAcceptedAt;

  useEffect(() => {
    if (blocking) headingRef.current?.focus();
  }, [blocking]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12" role="status" aria-live="polite">
        <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" aria-hidden="true" />
        <span className="sr-only">Loading...</span>
      </div>
    );
  }

  if (!blocking) return children;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!accepted) return;
    setSaving(true);
    setError('');
    try {
      await acceptAdminAgreement();
      await refreshUser();
    } catch (err) {
      setError(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl p-4">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 ref={headingRef} tabIndex={-1} className="outline-none">Admin User Agreement</h2>
          </CardTitle>
          <CardDescription>
            Please review and accept this agreement to access the admin dashboard.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit} noValidate>
            {error && (
              <div className="bg-destructive/10 text-destructive border border-destructive/20 rounded-lg p-3 text-sm" role="alert">
                {error}
              </div>
            )}
            <div className="bg-muted/50 border rounded-lg p-4 text-sm space-y-3 max-h-96 overflow-y-auto">
              <p>
                As an Admin User on plato, you have elevated access to platform data, including personally identifiable information (PII) belonging to other Users. By accepting this Agreement, you agree to use your Admin Access only for its intended purpose: administering, supporting, and maintaining the Platform and Program. You agree not to access, view, export, share, or otherwise use PII or other user data for any purpose outside your authorized administrative duties, including personal curiosity, unauthorized sharing, or any use unrelated to your role.
              </p>
              <p>
                You agree to protect the confidentiality and security of any PII or sensitive data you access, including by following the organization&apos;s security practices, not storing such data outside approved systems, and promptly reporting any suspected data breach, unauthorized access, or misuse you become aware of. You understand that Admin privileges may be reviewed, limited, or revoked at any time, and that misuse of this access may result in loss of Admin privileges, other account action, or legal consequences where applicable.
              </p>
              <p>
                By checking the box below, you confirm that you have read, understood, and agree to abide by this Agreement as a condition of retaining Admin Access.
              </p>
            </div>
            <div className="flex items-start gap-3">
              <Checkbox
                id="accept-agreement"
                checked={accepted}
                onCheckedChange={setAccepted}
                disabled={saving}
                aria-describedby="accept-label"
              />
              <label
                id="accept-label"
                htmlFor="accept-agreement"
                className="text-sm leading-relaxed cursor-pointer select-none"
              >
                I have read, understood, and agree to the Admin User Agreement
              </label>
            </div>
            <Button type="submit" disabled={saving || !accepted}>
              {saving ? 'Accepting...' : 'Accept and Continue'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
