import { useState, useEffect } from 'react';
import { useApp } from '../contexts/AppContext.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';
import PasswordField from '../components/PasswordField.jsx';
import {
  savePreferences,
  getLearnerProfileSummary, getLearnerProfile,
  saveLearnerProfile, saveLearnerProfileSummary,
} from '../../js/storage.js';
import { updateProfile } from '../../js/auth.js';
import * as orchestrator from '../../js/orchestrator.js';
import { syncInBackground } from '../lib/syncDebounce.js';
import { ensureProfileExists, mergeProfile } from '../lib/profileQueue.js';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from '@/components/ui/dialog';

export default function Settings() {
  const { state, dispatch } = useApp();
  const { user, refreshUser } = useAuth();
  const [name, setName] = useState(user?.name || state.preferences?.name || '');
  const [profileSummary, setProfileSummary] = useState('');

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordFeedback, setPasswordFeedback] = useState('');
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);
  const [nameFeedback, setNameFeedback] = useState('');
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  useEffect(() => {
    (async () => {
      setProfileSummary(await getLearnerProfileSummary());
    })();
  }, []);

  const handleSaveName = async (e) => {
    e.preventDefault();
    const trimmed = name.trim();
    const prefs = { ...state.preferences, name: trimmed };
    await savePreferences(prefs);
    dispatch({ type: 'SET_PREFERENCES', preferences: prefs });
    syncInBackground('preferences');

    try {
      await updateProfile({ name: trimmed });
      await refreshUser();
      setNameFeedback('Saved!');
    } catch (err) {
      setNameFeedback(err.message || 'Failed to update');
    }
    setTimeout(() => setNameFeedback(''), 2000);
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    if (!newPassword || newPassword.length < 8) {
      setPasswordFeedback('Password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordFeedback('Passwords do not match.');
      return;
    }
    setPasswordSubmitting(true);
    setPasswordFeedback('');
    try {
      await updateProfile({ password: newPassword });
      setNewPassword('');
      setConfirmPassword('');
      setPasswordFeedback('Password changed!');
    } catch (err) {
      setPasswordFeedback(err.message || 'Failed to change password');
    } finally {
      setPasswordSubmitting(false);
      setTimeout(() => setPasswordFeedback(''), 3000);
    }
  };

  return (
    <div className="mx-auto max-w-lg space-y-6 p-4">
      <h2 className="text-xl font-semibold">User Settings</h2>

      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Email</span>
            <span className="text-sm">{user?.email || ''}</span>
          </div>

          <Separator />

          <form className="space-y-3" onSubmit={handleSaveName}>
            <div className="space-y-1.5">
              <Label htmlFor="account-name">Name</Label>
              <Input id="account-name" type="text" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <Button type="submit">Save</Button>
            {nameFeedback && <p className="text-sm text-green-600" role="status" aria-live="polite">{nameFeedback}</p>}
          </form>

          <Separator />

          <form className="space-y-3" onSubmit={handleChangePassword}>
            <div className="space-y-1.5">
              <Label htmlFor="new-password">New Password</Label>
              <PasswordField
                id="new-password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={passwordSubmitting}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm-password">Confirm Password</Label>
              <PasswordField
                id="confirm-password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleChangePassword(e); } }}
                disabled={passwordSubmitting}
              />
            </div>
            <Button type="submit" disabled={passwordSubmitting}>
              {passwordSubmitting ? 'Changing...' : 'Change Password'}
            </Button>
            {passwordFeedback && <p className="text-sm text-muted-foreground" role="status" aria-live="polite">{passwordFeedback}</p>}
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle id="profile-heading">Learner Profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">Updated automatically by the AI as you complete activities.</p>
          <div className="rounded-md bg-muted p-3 text-sm leading-relaxed" aria-labelledby="profile-heading">
            {profileSummary || <em className="text-muted-foreground">No profile yet. Complete an activity to build your profile.</em>}
          </div>
          <Button variant="outline" onClick={() => setFeedbackOpen(true)}>
            Add Feedback
          </Button>
        </CardContent>
      </Card>

      <ProfileFeedbackDialog
        open={feedbackOpen}
        onOpenChange={setFeedbackOpen}
        onDone={async () => {
          setProfileSummary(await getLearnerProfileSummary());
        }}
      />
    </div>
  );
}

function ProfileFeedbackDialog({ open, onOpenChange, onDone }) {
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!text.trim()) return;
    setSubmitting(true);
    try {
      const profile = await ensureProfileExists();
      const result = await orchestrator.updateProfileFromFeedback(profile, text.trim(), {
        courseName: 'Settings', activityType: 'feedback', activityGoal: 'User-provided profile feedback',
      });
      if (result?.profile) {
        const merged = mergeProfile(profile, result.profile);
        await saveLearnerProfile(merged);
        if (result.summary) await saveLearnerProfileSummary(result.summary);
        syncInBackground('profile', 'profileSummary');
      }
      onOpenChange(false);
      setText('');
      if (onDone) onDone();
    } catch (e) {
      console.error('[plato] Profile feedback failed:', e?.message || e);
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Profile Feedback</DialogTitle>
          <DialogDescription>
            Share anything that seems inaccurate or missing -- your device, experience level, learning style, or anything else.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="profile-feedback-input" className="sr-only">Profile feedback</Label>
          <Textarea
            id="profile-feedback-input"
            rows={4}
            placeholder="e.g. I'm a complete beginner. I use a Chromebook and don't have admin access."
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleSubmit(); } }}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Updating...' : 'Submit'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
