import { useState, useRef, useId } from 'react';
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
  const [localImage, setLocalImage] = useState(null);
  const text = textProp !== undefined ? textProp : localText;
  const setText = onTextChange || setLocalText;
  const image = imageProp !== undefined ? imageProp : localImage;
  const setImage = onImageChange || setLocalImage;
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

  const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // Bedrock 5 MB limit

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    if (file.size > MAX_IMAGE_BYTES) {
      alert('Image must be under 5 MB.');
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setImage({ dataUrl: reader.result, name: file.name });
    reader.readAsDataURL(file);
    if (fileRef.current) fileRef.current.value = '';
  };

  const hasContent = text.trim() || image;

  return (
    <div className="px-4 pb-4 pt-2">
      <div className={`mx-auto max-w-3xl rounded-lg border border-input bg-background ${elevated ? 'shadow-lg' : ''}`}>
        {image && (
          <div className="relative m-2 inline-block">
            <img src={image.dataUrl} alt={image.name} className="h-20 rounded-md object-cover" />
            <Button
              variant="secondary"
              size="icon-xs"
              className="absolute -top-1.5 -right-1.5 rounded-full"
              onClick={() => setImage(null)}
              aria-label="Remove image"
            >
              &times;
            </Button>
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
          disabled={disabled}
        />
        <div className="flex items-center gap-1 px-2 pb-2">
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
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => fileRef.current?.click()}
                disabled={disabled}
                aria-label="Attach image"
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
