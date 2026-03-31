import { useState, useRef, useEffect } from 'react';

export default function NameStep({ data, updateData, goTo }) {
  const [name, setName] = useState(data.name || '');
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleNext = () => {
    if (!name.trim()) { inputRef.current?.focus(); return; }
    updateData({ name: name.trim() });
    goTo('apikey');
  };

  return (
    <div className="onboarding">
      <span className="onboarding-step-label">Step 1 of 2 — Your Name</span>
      <h2>What's your name?</h2>
      <p className="onboarding-lead">Let's start with your name.</p>
      <label htmlFor="onboarding-name" className="sr-only">Your name</label>
      <input
        ref={inputRef}
        type="text"
        id="onboarding-name"
        placeholder="Your name"
        autoComplete="given-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleNext(); } }}
      />
      <div className="action-bar">
        <button className="secondary-btn" onClick={() => goTo('welcome')}>Back</button>
        <button className="primary-btn" onClick={handleNext}>Continue</button>
      </div>
    </div>
  );
}
