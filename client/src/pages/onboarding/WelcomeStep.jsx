import { useModal } from '../../contexts/ModalContext.jsx';
import { useApp } from '../../contexts/AppContext.jsx';
import LoginModal from '../../components/modals/LoginModal.jsx';
import ConfirmModal from '../../components/modals/ConfirmModal.jsx';
import { getPreferences } from '../../../js/storage.js';
import { loadCourses } from '../../../js/courseOwner.js';
import * as auth from '../../../js/auth.js';

export default function WelcomeStep({ data, updateData, goTo }) {
  const { show: showModal } = useModal();
  const { dispatch } = useApp();

  const handleLogin = () => {
    showModal(
      <LoginModal onSuccess={async () => {
        const prefs = await getPreferences();
        const courses = await loadCourses();
        dispatch({ type: 'INIT_DATA', payload: { preferences: prefs, courses } });
        const authUser = await auth.getCurrentUser();
        updateData({ name: authUser?.name || prefs?.name || '' });
        goTo('name');
      }} />
    );
  };

  const handleSkip = () => {
    showModal(
      <ConfirmModal
        title="Continue without logging in?"
        message="By not logging in, credit for your work will not be given and changes won't be saved to the cloud."
        cancelLabel="Go Back"
        confirmLabel="Continue"
        confirmClass="primary-btn btn-success"
        onConfirm={() => goTo('name')}
      />
    );
  };

  return (
    <div className="onboarding">
      <h2>Learn by Doing</h2>
      <p className="onboarding-lead">1111 Learn helps you learn while building your professional portfolio.</p>
      <div className="onboarding-choice">
        <button className="primary-btn onboarding-choice-btn" onClick={handleLogin}>Login to Learn</button>
        <button className="onboarding-skip-btn" onClick={handleSkip}>Continue without logging in...</button>
      </div>
    </div>
  );
}
