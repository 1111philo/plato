import { useState, useRef, useId, useEffect } from 'react';
import { useAutoResize } from '../../hooks/useAutoResize.js';
import { Button } from '@/components/ui/button';

export default function ComposeBar({
  placeholder = 'Ask a question...',
  onSend,
  disabled = false,
  allowImages = false,
  elevated = false,
  text: textProp,
  onTextChange,
  image: imageProp,
  onImageChange,
}) {
  const [localText, setLocalText] = useState('');
  const [localImages, setLocalImages] = useState([]);
  const text = textProp !== undefined ? textProp : localText;
  const setText = onTextChange || setLocalText;
  // Support both legacy single-image prop and new array-based state
  const images = imageProp !== undefined ? (imageProp ? [imageProp] : []) : localImages;
  const setImages = onImageChange ? (imgs) => onImageChange(imgs[0] || null) : setLocalImages;
  const inputRef = useRef(null);
  const fileRef = useRef(null);
  const handleResize = useAutoResize();
  const inputId = useId();

  // The lesson chat mounts two ComposeBar instances — an inline one and a
  // fixed-overlay one — and a window-scroll listener swaps which is visible
  // (`composePinned` in `LessonChat.jsx`). Each instance owns its own
  // textarea ref. Without this effect, the freshly-mounted instance renders
  // at `rows={1}` (its default) even when `text` already has multiple lines,
  // because `useAutoResize` only fires on the `change` event and never sees
  // the externally-supplied initial value. Result before this fix: when the
  // user scrolls and the overlay swap happens, the textarea collapses back
  // to a single line. (Bug #161.) Resync on every change to `text`, which
  // covers both mount-with-prefilled-value and the rare case of the parent
  // setting text from outside (e.g. retry / paste flows).
  useEffect(() => {
    if (!inputRef.current) return;
    handleResize({ target: inputRef.current });
  }, [text, handleResize]);

  const send = () => {
    const val = text.trim();
    if ((!val && images.length === 0) || disabled) return;
    const payload = { text: val || null, imageDataUrls: images.map(img => img.dataUrl) };
    setText('');
    setImages([]);
    if (inputRef.current) { inputRef.current.style.height = 'auto'; inputRef.current.style.overflowY = 'hidden'; }
    onSend(payload);
  };

  const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // Bedrock 5 MB limit

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files || []);
    const imageFiles = files.filter(f => f.type.startsWith('image/'));
    if (imageFiles.length === 0) return;

    const oversized = imageFiles.filter(f => f.size > MAX_IMAGE_BYTES);
    if (oversized.length > 0) {
      alert(`${oversized.length} image(s) exceed the 5 MB limit and will be skipped.`);
    }

    const validFiles = imageFiles.filter(f => f.size <= MAX_IMAGE_BYTES);
    if (validFiles.length === 0) {
      if (fileRef.current) fileRef.current.value = '';
      return;
    }

    Promise.all(validFiles.map(file => new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve({ dataUrl: reader.result, name: file.name });
      reader.readAsDataURL(file);
    }))).then(newImages => {
      setImages(prev => [...prev, ...newImages]);
    });

    if (fileRef.current) fileRef.current.value = '';
  };

  const handlePaste = (e) => {
    if (!allowImages) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;
        if (file.size > MAX_IMAGE_BYTES) {
          alert('Image must be under 5 MB.');
          return;
        }
        const reader = new FileReader();
        reader.onload = () => setImages(prev => [...prev, { dataUrl: reader.result, name: file.name || 'pasted-image.png' }]);
        reader.readAsDataURL(file);
        return;
      }
    }
  };

  const hasContent = text.trim() || images.length > 0;

  return (
    <div className="px-4 pb-4 pt-2">
      <div className={`mx-auto max-w-3xl rounded-lg border border-input bg-background ${elevated ? 'shadow-lg' : ''}`}>
        {images.length > 0 && (
          <div className="m-2 flex flex-wrap gap-2">
            {images.map((img, idx) => (
              <div key={idx} className="relative inline-block">
                <img src={img.dataUrl} alt={img.name} className="h-20 rounded-md object-cover" />
                <Button
                  variant="secondary"
                  size="icon-xs"
                  className="absolute -top-1.5 -right-1.5 rounded-full"
                  onClick={() => setImages(prev => prev.filter((_, i) => i !== idx))}
                  aria-label={`Remove ${img.name}`}
                >
                  &times;
                </Button>
              </div>
            ))}
          </div>
        )}
        <label htmlFor={inputId} className="sr-only">Your message</label>
        <textarea
          ref={inputRef}
          id={inputId}
          className="w-full resize-none bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
          rows={1}
          placeholder={placeholder}
          value={text}
          onChange={(e) => { setText(e.target.value); handleResize(e); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); }
          }}
          onPaste={handlePaste}
          disabled={disabled}
        />
        <div className="flex items-center gap-1 px-2 pb-2">
          {allowImages && (
            <>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleFileChange}
                className="sr-only"
                aria-label="Upload images"
              />
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => fileRef.current?.click()}
                disabled={disabled}
                aria-label="Attach images"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
              </Button>
            </>
          )}
          <div className="flex-1" />
          <Button
            variant="default"
            size="icon-sm"
            className={`transition-opacity ${hasContent ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
            aria-label="Send"
            onClick={send}
            disabled={disabled || !hasContent}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="12" y1="19" x2="12" y2="5" />
              <polyline points="5 12 12 5 19 12" />
            </svg>
          </Button>
        </div>
      </div>
    </div>
  );
}
