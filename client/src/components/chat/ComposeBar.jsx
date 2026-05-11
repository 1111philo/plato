import { useState, useRef, useId, useEffect } from 'react';
import { useAutoResize } from '../../hooks/useAutoResize.js';
import { Button } from '@/components/ui/button';

const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // Bedrock 5 MB limit

function readImageAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ dataUrl: reader.result, name: file.name || 'image.png' });
    reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

export default function ComposeBar({
  placeholder = 'Ask a question...',
  onSend,
  disabled = false,
  allowImages = false,
  elevated = false,
  text: textProp,
  onTextChange,
  images: imagesProp,
  onImagesChange,
}) {
  const [localText, setLocalText] = useState('');
  const [localImages, setLocalImages] = useState([]); // array of { dataUrl, name }
  const [loadingImages, setLoadingImages] = useState(false);
  const text = textProp !== undefined ? textProp : localText;
  const setText = onTextChange || setLocalText;
  const images = imagesProp !== undefined ? imagesProp : localImages;
  const setImages = onImagesChange || setLocalImages;
  const inputRef = useRef(null);
  const fileRef = useRef(null);
  const handleResize = useAutoResize();
  const inputId = useId();
  const statusId = useId();
  const [loadingCount, setLoadingCount] = useState(0);

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
    if ((!val && images.length === 0) || disabled || loadingImages) return;
    const imageDataUrls = images.length > 0 ? images.map(i => i.dataUrl) : null;
    const payload = { text: val || null, imageDataUrls };
    setText('');
    setImages([]);
    if (inputRef.current) { inputRef.current.style.height = 'auto'; inputRef.current.style.overflowY = 'hidden'; }
    onSend(payload);
  };

  // Reads N files in parallel, applies a single state update once all readers
  // resolve. Disabling Send while pending closes the race where a fast user
  // could submit before async readers finished.
  const addImagesFromFiles = async (files) => {
    const remaining = MAX_IMAGES - images.length;
    if (remaining <= 0) {
      alert(`You can attach up to ${MAX_IMAGES} images per message.`);
      return;
    }
    const valid = [];
    let oversize = false;
    for (const file of files) {
      if (!file || !file.type.startsWith('image/')) continue;
      if (file.size > MAX_IMAGE_BYTES) { oversize = true; continue; }
      valid.push(file);
      if (valid.length >= remaining) break;
    }
    if (oversize) alert('Image must be under 5 MB.');
    if (files.length > valid.length + (oversize ? 1 : 0)) {
      alert(`You can attach up to ${MAX_IMAGES} images per message.`);
    }
    if (!valid.length) return;

    setLoadingImages(true);
    setLoadingCount(valid.length);
    try {
      const loaded = await Promise.all(valid.map(readImageAsDataUrl));
      setImages([...images, ...loaded].slice(0, MAX_IMAGES));
    } catch {
      alert('Failed to read image. Please try again.');
    } finally {
      setLoadingImages(false);
      setLoadingCount(0);
    }
  };

  const handleFileChange = async (e) => {
    const files = Array.from(e.target.files || []);
    if (fileRef.current) fileRef.current.value = '';
    if (!files.length) return;
    await addImagesFromFiles(files);
  };

  const handlePaste = (e) => {
    if (!allowImages) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    const files = [];
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length === 0) return;
    e.preventDefault();
    addImagesFromFiles(files);
  };

  const removeImage = (idx) => {
    setImages(images.filter((_, i) => i !== idx));
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
                  onClick={() => removeImage(idx)}
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
                aria-label={`Upload images (up to ${MAX_IMAGES})`}
              />
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => fileRef.current?.click()}
                disabled={disabled || images.length >= MAX_IMAGES}
                aria-label={images.length >= MAX_IMAGES
                  ? `Maximum ${MAX_IMAGES} images attached`
                  : 'Attach images'}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
              </Button>
              {/* Persistent live region — keeps the same node mounted so transitions
                  (e.g. "Loading 3 images…" → cleared) are announced reliably. */}
              <span id={statusId} className="text-xs text-muted-foreground" role="status" aria-live="polite">
                {loadingImages ? `Loading ${loadingCount} image${loadingCount === 1 ? '' : 's'}…` : ''}
              </span>
            </>
          )}
          <div className="flex-1" />
          <Button
            variant="default"
            size="icon-sm"
            className={`transition-opacity ${hasContent ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
            aria-label="Send"
            aria-describedby={allowImages && loadingImages ? statusId : undefined}
            onClick={send}
            disabled={disabled || !hasContent || loadingImages}
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
