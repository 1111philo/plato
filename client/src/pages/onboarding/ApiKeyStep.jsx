import { useState, useRef, useEffect } from 'react';
import PasswordField from '../../components/PasswordField.jsx';
import { getApiKey, saveApiKey } from '../../../js/storage.js';

export default function ApiKeyStep({ data, updateData, goTo, onComplete }) {
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    (async () => {
      const existing = await getApiKey();
      if (existing) setKey('\u2022'.repeat(40));
      inputRef.current?.focus();
    })();
  }, []);

  const handleNext = async () => {
    const raw = key.trim();
    const PLACEHOLDER = '\u2022'.repeat(40);
    const actual = raw === PLACEHOLDER ? await getApiKey() : raw;

    if (!actual) {
      setError('Please enter an API key.');
      inputRef.current?.focus();
      return;
    }
    if (raw !== PLACEHOLDER) await saveApiKey(actual);
    if (onComplete) onComplete();
    else goTo('name');
  };

  return (
    <div className="onboarding">
      <span className="onboarding-step-label">Step 2 of 2 — Connect AI</span>
      <h2>Connect your AI.</h2>
      <p className="onboarding-lead">
        Enter your <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">Anthropic API key</a> to get started — your key stays on your device.
      </p>
      <label htmlFor="onboarding-apikey" className="sr-only">Anthropic API key</label>
      <PasswordField
        id="onboarding-apikey"
        placeholder="sk-ant-..."
        value={key}
        onChange={(e) => { setKey(e.target.value); setError(''); }}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleNext(); } }}
        inputRef={inputRef}
      />
      {error && <div className="onboarding-error" role="alert" aria-live="polite">{error}</div>}
      <div className="action-bar">
        <button className="secondary-btn" onClick={() => goTo('name')}>Back</button>
        <button className="primary-btn" onClick={handleNext}>Continue</button>
      </div>
    </div>
  );
}
