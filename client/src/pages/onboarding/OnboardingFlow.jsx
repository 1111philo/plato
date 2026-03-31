import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useApp } from '../../contexts/AppContext.jsx';
import OnboardingCanvas from '../../components/OnboardingCanvas.jsx';
import WelcomeStep from './WelcomeStep.jsx';
import NameStep from './NameStep.jsx';
import ApiKeyStep from './ApiKeyStep.jsx';
import {
  saveOnboardingComplete, savePreferences,
} from '../../../js/storage.js';
import { syncInBackground } from '../../lib/syncDebounce.js';
import { ensureProfileExists } from '../../lib/profileQueue.js';

export default function OnboardingFlow() {
  const navigate = useNavigate();
  const { loggedIn, user } = useAuth();
  const { state, dispatch } = useApp();
  const [step, setStep] = useState(loggedIn ? null : 'welcome');
  const [data, setData] = useState({ name: state.preferences?.name || '' });

  // Logged-in users skip onboarding entirely — name comes from the service
  useEffect(() => {
    if (loggedIn) {
      (async () => {
        const name = user?.name || state.preferences?.name || '';
        if (name) {
          const prefs = { ...state.preferences, name };
          await savePreferences(prefs);
          dispatch({ type: 'SET_PREFERENCES', preferences: prefs });
          syncInBackground('preferences');
        }
        await ensureProfileExists(name);
        await saveOnboardingComplete();
        syncInBackground('onboardingComplete');
        navigate('/courses', { replace: true });
      })();
    }
  }, [loggedIn]);

  const updateData = (updates) => {
    setData(prev => ({ ...prev, ...updates }));
  };

  const complete = async () => {
    const prefs = { ...state.preferences, name: data.name };
    await savePreferences(prefs);
    dispatch({ type: 'SET_PREFERENCES', preferences: prefs });
    syncInBackground('preferences');
    await ensureProfileExists(data.name);
    await saveOnboardingComplete();
    syncInBackground('onboardingComplete');
    navigate('/courses', { replace: true });
  };

  // Logged-in users see nothing (redirect happens in useEffect)
  if (loggedIn) {
    return (
      <div className="onboarding-backdrop">
        <OnboardingCanvas />
        <div className="onboarding-card">
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <span className="loading-spinner-inline" aria-hidden="true" />
          </div>
        </div>
      </div>
    );
  }

  const showLogo = step === 'welcome';

  let content;
  switch (step) {
    case 'welcome':
      content = <WelcomeStep data={data} updateData={updateData} goTo={setStep} />;
      break;
    case 'name':
      content = <NameStep data={data} updateData={updateData} goTo={setStep} />;
      break;
    case 'apikey':
      content = <ApiKeyStep data={data} updateData={updateData} goTo={setStep} onComplete={complete} />;
      break;
    default:
      content = <WelcomeStep data={data} updateData={updateData} goTo={setStep} />;
  }

  return (
    <div className="onboarding-backdrop">
      <OnboardingCanvas />
      {showLogo && (
        <a href="https://philosophers.group/" target="_blank" rel="noopener" className="onboarding-logo-link">
          <img src="assets/icon-128.png" alt="1111" className="onboarding-logo" />
        </a>
      )}
      <div className="onboarding-card">
        {content}
      </div>
    </div>
  );
}
