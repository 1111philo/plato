import { useState, useRef, useId, useEffect } from 'react';
import { useAutoResize } from '../../hooks/useAutoResize.js';
import { compressImageDataUrl } from '../../lib/imageCompression.js';
import { fetchLinkContent } from '../../lib/links.js';
import { Button } from '@/components/ui/button';

const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // Bedrock 5 MB limit
const MAX_LINKS = 3;

function readImageAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ dataUrl: reader.result, name: file.name || 'image.png' });
    reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

// "https://www.example.com/path" → "example.com" for compact chip labels.
function hostLabel(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

export default function ComposeBar({
  placeholder = 'Ask a question...',
  onSend,
  disabled = false,
  allowImages = false,
  allowLinks = false,
  elevated = false,
  text: textProp,
  onTextChange,
  images: imagesProp,
  onImagesChange,
  links: linksProp,
  onLinksChange,
}) {
  const [localText, setLocalText] = useState('');
  const [localImages, setLocalImages] = useState([]); // array of { dataUrl, name }
  const [localLinks, setLocalLinks] = useState([]); // array of { url, title, siteName, text }
  const [loadingImages, setLoadingImages] = useState(false);
  const text = textProp !== undefined ? textProp : localText;
  const setText = onTextChange || setLocalText;
  const images = imagesProp !== undefined ? imagesProp : localImages;
  const setImages = onImagesChange || setLocalImages;
  const links = linksProp !== undefined ? linksProp : localLinks;
  const setLinks = onLinksChange || setLocalLinks;
  const inputRef = useRef(null);
  const fileRef = useRef(null);
  const linkInputRef = useRef(null);
  const linkButtonRef = useRef(null);
  const handleResize = useAutoResize();
  const inputId = useId();
  const statusId = useId();
  const linkInputId = useId();
  const linkGroupId = useId();
  const [loadingCount, setLoadingCount] = useState(0);

  // Link-attach UI state.
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState('');
  const [fetchingLink, setFetchingLink] = useState(false);
  const [linkError, setLinkError] = useState('');

  useEffect(() => {
    if (linkOpen) linkInputRef.current?.focus();
  }, [linkOpen]);

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
    if ((!val && images.length === 0 && links.length === 0) || disabled || loadingImages || fetchingLink) return;
    const imageDataUrls = images.length > 0 ? images.map(i => i.dataUrl) : null;
    const linkPayload = links.length > 0 ? links.map(l => ({ url: l.url, title: l.title, text: l.text })) : null;
    const payload = { text: val || null, imageDataUrls, links: linkPayload };
    setText('');
    setImages([]);
    setLinks([]);
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
      // Read each file independently (allSettled, not all): a single
      // unreadable file must not discard the others. FileReader rejects with
      // a DOMException whose `.name` is the actionable signal — e.g.
      // NotReadableError (file locked by antivirus / in use) or NotFoundError
      // (a OneDrive "files on-demand" entry not yet downloaded locally). We
      // surface that name so a screenshot of the alert is self-diagnosing
      // (issue #228 — "Failed to read image" with no other clue).
      const settled = await Promise.allSettled(valid.map(readImageAsDataUrl));
      const loaded = [];
      const readErrors = [];
      for (const r of settled) {
        if (r.status === 'fulfilled') loaded.push(r.value);
        else { readErrors.push(r.reason); console.error('[plato] failed to read image', r.reason); }
      }
      if (readErrors.length > 0) {
        const reason = readErrors[0]?.name || readErrors[0]?.message || 'unknown error';
        const n = readErrors.length;
        alert(`Couldn't read ${n} image${n === 1 ? '' : 's'} (${reason}). Please try again or pick a different file.`);
      }
      if (loaded.length === 0) return;
      // Compress before the image enters the compose state: it's persisted
      // one-per-record as `screenshot:*` sync data, which DynamoDB caps at
      // 400 KB. A raw screenshot can blow that limit (issues #191, #193).
      const compressed = await Promise.all(loaded.map(async (img) => ({
        ...img,
        dataUrl: await compressImageDataUrl(img.dataUrl),
      })));
      // Filter out images that couldn't be compressed enough (null dataUrl)
      const usable = compressed.filter(img => img.dataUrl !== null);
      if (usable.length < compressed.length) {
        alert(`${compressed.length - usable.length} image(s) were too large and could not be compressed enough. Please use smaller images.`);
      }
      setImages([...images, ...usable].slice(0, MAX_IMAGES));
    } catch (err) {
      console.error('[plato] image processing failed', err);
      alert(`Failed to read image (${err?.name || err?.message || 'unknown error'}). Please try again.`);
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

  const openLinkInput = () => {
    setLinkError('');
    setLinkValue('');
    setLinkOpen(true);
  };

  // Close the link input and move focus to a sensible place so keyboard and
  // screen-reader users aren't dropped on document.body. After a successful
  // add we send focus to the message textarea (continue composing); on cancel
  // we return it to the link toggle button (the trigger), falling back to the
  // textarea if that button is now disabled (e.g. max links reached).
  const closeLinkInput = (focusTarget = 'button') => {
    setLinkOpen(false);
    setLinkValue('');
    setLinkError('');
    requestAnimationFrame(() => {
      if (focusTarget === 'button' && linkButtonRef.current && !linkButtonRef.current.disabled) {
        linkButtonRef.current.focus();
      } else {
        inputRef.current?.focus();
      }
    });
  };

  const addLink = async () => {
    const raw = linkValue.trim();
    if (!raw || fetchingLink) return;
    if (links.length >= MAX_LINKS) { setLinkError(`You can attach up to ${MAX_LINKS} links.`); return; }
    // Be forgiving about a missing scheme — the server validates for real.
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    setFetchingLink(true);
    setLinkError('');
    try {
      const result = await fetchLinkContent(url);
      setLinks([...links, {
        url: result.finalUrl || result.url || url,
        title: result.title || hostLabel(url),
        siteName: result.siteName || null,
        text: result.text || '',
      }].slice(0, MAX_LINKS));
      closeLinkInput('textarea');
    } catch (e) {
      setLinkError(e.message || "Couldn't load that link.");
    } finally {
      setFetchingLink(false);
    }
  };

  const removeLink = (idx) => {
    setLinks(links.filter((_, i) => i !== idx));
  };

  const hasContent = text.trim() || images.length > 0 || links.length > 0;
  const busy = loadingImages || fetchingLink;

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
        {links.length > 0 && (
          <div className="m-2 flex flex-wrap gap-2">
            {links.map((link, idx) => (
              <div key={idx} className="relative inline-flex max-w-full">
                {/* The chip body is a focusable link so keyboard/SR users can
                    reach it, hear the full URL (aria-label), and open it to
                    verify before deciding whether to remove it — the remove
                    button alone left the URL inaccessible without a mouse. */}
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={link.url}
                  aria-label={`Attached link: ${link.title} — ${link.url} — opens in a new tab`}
                  className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-input bg-muted py-1 pl-2 pr-6 text-xs hover:bg-muted/70"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 text-muted-foreground">
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                  </svg>
                  <span className="truncate max-w-[12rem]" aria-hidden="true">{link.title}</span>
                  <span className="text-muted-foreground shrink-0" aria-hidden="true">{hostLabel(link.url)}</span>
                </a>
                <Button
                  variant="secondary"
                  size="icon-xs"
                  className="absolute -top-1.5 -right-1.5 rounded-full"
                  onClick={() => removeLink(idx)}
                  aria-label={`Remove link ${link.title}`}
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
        {allowLinks && linkOpen && (
          <div id={linkGroupId} className="mx-2 mb-2 flex flex-col gap-1" role="group" aria-label="Attach a link">
            <div className="flex items-center gap-2">
              <label htmlFor={linkInputId} className="sr-only">Link URL</label>
              <input
                ref={linkInputRef}
                id={linkInputId}
                type="url"
                inputMode="url"
                placeholder="Paste a link (https://…)"
                value={linkValue}
                onChange={(e) => setLinkValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); addLink(); }
                  if (e.key === 'Escape') { e.preventDefault(); closeLinkInput('button'); }
                }}
                disabled={fetchingLink}
                aria-describedby={linkError ? `${linkInputId}-err` : undefined}
                aria-invalid={linkError ? true : undefined}
                className="flex-1 rounded-md border border-input bg-background px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
              />
              <Button variant="default" size="sm" onClick={addLink} disabled={!linkValue.trim() || fetchingLink}>
                {fetchingLink ? 'Adding…' : 'Add'}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => closeLinkInput('button')} disabled={fetchingLink}>
                Cancel
              </Button>
            </div>
            {linkError && (
              <p id={`${linkInputId}-err`} className="text-xs text-destructive" role="alert">{linkError}</p>
            )}
          </div>
        )}
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
            </>
          )}
          {allowLinks && (
            <Button
              ref={linkButtonRef}
              variant="ghost"
              size="icon-sm"
              onClick={() => (linkOpen ? closeLinkInput('button') : openLinkInput())}
              disabled={disabled || links.length >= MAX_LINKS}
              aria-label={links.length >= MAX_LINKS
                ? `Maximum ${MAX_LINKS} links attached`
                : 'Attach a link'}
              aria-expanded={linkOpen}
              aria-controls={linkGroupId}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
              </svg>
            </Button>
          )}
          {/* Persistent live region — keeps the same node mounted so transitions
              (e.g. "Loading 3 images…" → cleared) are announced reliably. */}
          {(allowImages || allowLinks) && (
            <span id={statusId} className="text-xs text-muted-foreground" role="status" aria-live="polite">
              {loadingImages ? `Loading ${loadingCount} image${loadingCount === 1 ? '' : 's'}…` : (fetchingLink ? 'Fetching link…' : '')}
            </span>
          )}
          <div className="flex-1" />
          <Button
            variant="default"
            size="icon-sm"
            className={`transition-opacity ${hasContent ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
            aria-label="Send"
            aria-describedby={(allowImages || allowLinks) && busy ? statusId : undefined}
            onClick={send}
            disabled={disabled || !hasContent || busy}
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
