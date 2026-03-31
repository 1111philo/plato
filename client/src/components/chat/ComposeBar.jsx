import { useState, useRef, useId } from 'react';
import { useAutoResize } from '../../hooks/useAutoResize.js';

export default function ComposeBar({
  placeholder = 'Ask a question...',
  onSend,
  disabled = false,
  allowImages = false,
}) {
  const [text, setText] = useState('');
  const [image, setImage] = useState(null);
  const inputRef = useRef(null);
  const fileRef = useRef(null);
  const handleResize = useAutoResize();
  const inputId = useId();

  const send = () => {
    const val = text.trim();
    if ((!val && !image) || disabled) return;
    const payload = { text: val || null, imageDataUrl: image?.dataUrl || null };
    setText('');
    setImage(null);
    if (inputRef.current) inputRef.current.style.height = 'auto';
    onSend(payload);
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => setImage({ dataUrl: reader.result, name: file.name });
    reader.readAsDataURL(file);
    if (fileRef.current) fileRef.current.value = '';
  };

  const hasContent = text.trim() || image;

  return (
    <div className="chat-compose">
      <div className="compose-card">
        {image && (
          <div className="compose-image-preview">
            <img src={image.dataUrl} alt={image.name} />
            <button className="compose-image-remove" onClick={() => setImage(null)} aria-label="Remove image">&times;</button>
          </div>
        )}
        <label htmlFor={inputId} className="sr-only">Your message</label>
        <textarea
          ref={inputRef}
          id={inputId}
          className="chat-input"
          rows={1}
          placeholder={placeholder}
          value={text}
          onChange={(e) => { setText(e.target.value); handleResize(e); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); }
          }}
          disabled={disabled}
        />
        <div className="compose-actions">
          {allowImages && (
            <>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                className="sr-only"
                aria-label="Upload image"
              />
              <button
                className="compose-attach-btn"
                onClick={() => fileRef.current?.click()}
                disabled={disabled}
                aria-label="Attach image"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
              </button>
            </>
          )}
          <div style={{ flex: 1 }} />
          <button className={`compose-send-btn${hasContent ? ' visible' : ''}`} aria-label="Send" onClick={send} disabled={disabled || !hasContent}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="12" y1="19" x2="12" y2="5" />
              <polyline points="5 12 12 5 19 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
