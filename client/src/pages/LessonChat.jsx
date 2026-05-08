import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getLessonById } from '../../js/storage.js';
import {
  startLesson, sendMessage, resumeLesson,
  applyCoachResponseToKB,
} from '../lib/lessonEngine.js';
import { LESSON_PHASES, MSG_TYPES } from '../lib/constants.js';
import { PluginSlot } from '../lib/plugins.jsx';

const TEXTAREA_MIN_ROWS = 1;
const TEXTAREA_LINE_HEIGHT = 24; // px — matches the CSS line-height below
const TEXTAREA_MAX_HEIGHT = 200; // px

/**
 * Resize a textarea to fit its content without the flicker caused by
 * the two-step `height='auto'` → `height=scrollHeight+'px'` pattern.
 *
 * Setting height to '0' forces the browser to recalculate scrollHeight
 * against the content (not the current box size), then we set the real
 * height in the same synchronous call — no intermediate paint-frame
 * where height is 'auto' and a scroll event can reset it.
 */
function resizeTextarea(el) {
  if (!el) return;
  el.style.height = '0';
  const next = Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT);
  el.style.height = `${Math.max(next, TEXTAREA_LINE_HEIGHT * TEXTAREA_MIN_ROWS)}px`;
  el.style.overflowY = el.scrollHeight > TEXTAREA_MAX_HEIGHT ? 'auto' : 'hidden';
}

function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 px-4 py-2">
      <span className="w-2 h-2 rounded-full bg-muted-foreground animate-bounce [animation-delay:0ms]" />
      <span className="w-2 h-2 rounded-full bg-muted-foreground animate-bounce [animation-delay:150ms]" />
      <span className="w-2 h-2 rounded-full bg-muted-foreground animate-bounce [animation-delay:300ms]" />
    </div>
  );
}

function ChatBubble({ msg }) {
  const isUser = msg.role === 'user' || msg.msgType === MSG_TYPES.USER;
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm leading-relaxed ${
          isUser
            ? 'bg-primary text-primary-foreground rounded-br-sm'
            : 'bg-muted text-foreground rounded-bl-sm'
        }`}
      >
        {isUser ? (
          <div className="whitespace-pre-wrap">{msg.content}</div>
        ) : (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content || ''}</ReactMarkdown>
        )}
        {msg.imageUrl && (
          <img src={msg.imageUrl} alt="Uploaded" className="mt-2 max-w-full rounded-lg" />
        )}
      </div>
    </div>
  );
}

export default function LessonChat() {
  const { lessonId } = useParams();
  const navigate = useNavigate();

  const [lesson, setLesson] = useState(null);
  const [messages, setMessages] = useState([]);
  const [lessonKB, setLessonKB] = useState(null);
  const [phase, setPhase] = useState(LESSON_PHASES.LESSON_INTRO);
  const [input, setInput] = useState('');
  const [imageDataUrl, setImageDataUrl] = useState(null);
  const [sending, setSending] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);

  // ── Scroll helpers ──────────────────────────────────────────────────────────
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, streamingText, scrollToBottom]);

  // ── Textarea auto-resize ────────────────────────────────────────────────────
  // Re-measure on every input change.
  useEffect(() => {
    resizeTextarea(textareaRef.current);
  }, [input]);

  // Also re-measure if the container width changes (viewport resize, panel toggle).
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => resizeTextarea(el));
    ro.observe(el.parentElement || el);
    return () => ro.disconnect();
  }, []);

  // ── Lesson bootstrap ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!lessonId) return;
    setLoading(true);
    getLessonById(lessonId)
      .then(async (l) => {
        if (!l) { navigate('/lessons'); return; }
        setLesson(l);
        const resumed = await resumeLesson(lessonId, l, (chunk) => {
          setStreamingText(chunk);
          setStreaming(true);
        });
        if (resumed) {
          setMessages(resumed.messages);
          setLessonKB(resumed.lessonKB);
          setPhase(resumed.phase);
          setStreaming(false);
          setStreamingText('');
        } else {
          const started = await startLesson(lessonId, l, (chunk) => {
            setStreamingText(chunk);
            setStreaming(true);
          });
          setMessages(started.messages);
          setLessonKB(started.lessonKB);
          setPhase(started.phase);
          setStreaming(false);
          setStreamingText('');
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [lessonId, navigate]);

  // ── Send ────────────────────────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if ((!trimmed && !imageDataUrl) || sending || !lesson) return;

    const userMsg = {
      role: 'user',
      msgType: MSG_TYPES.USER,
      content: trimmed,
      imageUrl: imageDataUrl,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setImageDataUrl(null);
    setSending(true);
    setStreaming(true);
    setStreamingText('');

    // Reset textarea height immediately after clearing input
    requestAnimationFrame(() => resizeTextarea(textareaRef.current));

    try {
      const result = await sendMessage(
        lessonId,
        lesson,
        trimmed,
        imageDataUrl,
        (chunk) => setStreamingText(chunk),
      );
      setMessages(result.messages);
      setLessonKB(result.lessonKB);
      setPhase(result.phase);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
      setStreaming(false);
      setStreamingText('');
    }
  }, [input, imageDataUrl, sending, lesson, lessonId]);

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleImageChange = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setImageDataUrl(ev.target.result);
    reader.readAsDataURL(file);
  }, []);

  const isCompleted = lessonKB?.status === 'completed';
  const canSend = (input.trim() || imageDataUrl) && !sending;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-muted-foreground text-sm">Loading lesson…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <div className="text-destructive text-sm">{error}</div>
        <button
          className="text-sm underline text-muted-foreground"
          onClick={() => navigate('/lessons')}
        >
          Back to lessons
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <button
          onClick={() => navigate('/lessons')}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          ← Back
        </button>
        <h1 className="text-sm font-semibold truncate max-w-[60%]">{lesson?.name}</h1>
        <div className="w-16" />
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {messages.map((msg, i) => (
          <ChatBubble key={i} msg={msg} />
        ))}
        {streaming && streamingText && (
          <div className="flex justify-start mb-3">
            <div className="max-w-[80%] rounded-2xl rounded-bl-sm px-4 py-2 text-sm leading-relaxed bg-muted text-foreground">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamingText}</ReactMarkdown>
            </div>
          </div>
        )}
        {streaming && !streamingText && <TypingIndicator />}
        <div ref={messagesEndRef} />
      </div>

      {/* Post-completion plugin slot */}
      {isCompleted && (
        <PluginSlot
          slot="learnerCompletionAfter"
          props={{ lessonId, lessonKB }}
        />
      )}

      {/* Input area */}
      <div className="border-t px-4 py-3">
        {imageDataUrl && (
          <div className="mb-2 relative inline-block">
            <img
              src={imageDataUrl}
              alt="Preview"
              className="max-h-24 rounded-lg border"
            />
            <button
              onClick={() => setImageDataUrl(null)}
              className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-destructive text-destructive-foreground text-xs flex items-center justify-center"
              aria-label="Remove image"
            >
              ×
            </button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={sending}
            className="shrink-0 p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40"
            aria-label="Attach image"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleImageChange}
          />
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isCompleted ? 'Share feedback…' : 'Type a message… (Shift+Enter for new line)'}
            disabled={sending}
            rows={1}
            style={{
              lineHeight: `${TEXTAREA_LINE_HEIGHT}px`,
              height: `${TEXTAREA_LINE_HEIGHT * TEXTAREA_MIN_ROWS}px`,
              overflowY: 'hidden',
            }}
            className="flex-1 resize-none rounded-xl border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          />
          <button
            onClick={handleSend}
            disabled={!canSend}
            className="shrink-0 p-2 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40"
            aria-label="Send message"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
