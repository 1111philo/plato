import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useApp } from '../contexts/AppContext.jsx';
import { useStreamedText } from '../hooks/useStreamedText.js';
import { useTitleNotification } from '../hooks/useTitleNotification.js';
import { LESSON_PHASES, MSG_TYPES } from '../lib/constants.js';
import { launchConfetti } from '../lib/confetti.js';
import {
  getLessonKB, deleteLessonProgress,
  getUserLessonMarkdown, deleteUserLesson,
} from '../../js/storage.js';
import { invalidateLessonsCache, loadLessons } from '../../js/lessonOwner.js';
import * as engine from '../lib/lessonEngine.js';
import { getLinkAnswerPolicy, getLinkSubmissionGuidance } from '../lib/linkAnswerPolicy.js';

import ChatArea from '../components/chat/ChatArea.jsx';
import ThinkingSpinner from '../components/chat/ThinkingSpinner.jsx';
import UserMessage from '../components/chat/UserMessage.jsx';
import AssistantMessage from '../components/chat/AssistantMessage.jsx';
import ProgressBar from '../components/chat/ProgressBar.jsx';
import ComposeBar from '../components/chat/ComposeBar.jsx';
import ConfirmModal from '../components/modals/ConfirmModal.jsx';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from '@/components/ui/dialog';

export default function LessonChat() {
  const { lessonGroupId } = useParams();
  const navigate = useNavigate();
  const { state, dispatch } = useApp();
  const { lessons } = state;
  const lesson = lessons.find(c => c.lessonId === lessonGroupId);

  const [phase, setPhase] = useState(null);
  const [messages, setMessages] = useState([]);
  const [lessonKB, setLessonKB] = useState(null);
  const [loading, setLoading] = useState('');
  const [error, setError] = useState('');
  const [linkNotice, setLinkNotice] = useState('');

  const [streamingText, setStreamingText] = useState(null);
  const displayText = useStreamedText(streamingText);
  const pendingAfterStreamRef = useRef(null);
  const [srAnnouncement, setSrAnnouncement] = useState('');
  const srClearTimeoutRef = useRef(null);
  const srRafRef = useRef(null);
  const chatAreaRef = useRef(null);
  const notifyTitle = useTitleNotification(
    lesson ? `${lesson.name} — plato` : 'Lesson — plato'
  );

  // Confirm modal state
  const [confirmModal, setConfirmModal] = useState(null);
  const [showObjectives, setShowObjectives] = useState(false);
  const objectivesTitleRef = useRef(null);
  const [headerPinned, setHeaderPinned] = useState(false);
  const headerRef = useRef(null);
  const [composePinned, setComposePinned] = useState(true);
  const composeAnchorRef = useRef(null);
  const [composeText, setComposeText] = useState('');
  const [composeImage, setComposeImage] = useState(null);

  // Pin header when its top edge reaches the viewport top
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const check = () => {
      const rect = el.getBoundingClientRect();
      setHeaderPinned(rect.top < 0);
    };
    const checkCompose = () => {
      const anchor = composeAnchorRef.current;
      if (anchor) {
        const rect = anchor.getBoundingClientRect();
        // Unpin only when the bottom of the inline compose is fully visible
        setComposePinned(rect.bottom > window.innerHeight);
      }
    };
    const checkAll = () => { check(); checkCompose(); };
    window.addEventListener('scroll', checkAll, true);
    checkAll();
    return () => window.removeEventListener('scroll', checkAll, true);
  }, []);

  useEffect(() => {
    if (displayText === null && pendingAfterStreamRef.current) {
      const { msgs, p, confetti } = pendingAfterStreamRef.current;
      pendingAfterStreamRef.current = null;
      if (msgs) {
        setMessages(prev => [...prev, ...msgs]);
        const hasAssistant = msgs.some(m => m.role === 'assistant');
        if (hasAssistant) {
          if (srClearTimeoutRef.current) clearTimeout(srClearTimeoutRef.current);
          if (srRafRef.current) cancelAnimationFrame(srRafRef.current);
          setSrAnnouncement('');
          notifyTitle();
          // If focus is inside the chat log, move it to the new message so
          // VoiceOver announces it via the inline "Coach says:" prefix.
          // Otherwise fire the live region — both paths must not run together
          // or VoiceOver reads "Coach says: … New message from coach" as one
          // utterance, which sounds like the coach said those words.
          srRafRef.current = requestAnimationFrame(() => {
            srRafRef.current = null;
            const log = chatAreaRef.current;
            const focusInLog = log && (log.contains(document.activeElement) || document.activeElement === log);
            if (focusInLog) {
              const assistantMsgs = log.querySelectorAll('[data-chat-message="assistant"]');
              const last = assistantMsgs[assistantMsgs.length - 1];
              if (last) last.focus();
            } else {
              setSrAnnouncement('New message from coach');
              srClearTimeoutRef.current = setTimeout(() => setSrAnnouncement(''), 3000);
            }
          });
        }
      }
      if (p) setPhase(p);
      if (confetti) launchConfetti();
      setLoading('');
    }
  }, [displayText]);

  useEffect(() => () => {
    if (srClearTimeoutRef.current) clearTimeout(srClearTimeoutRef.current);
    if (srRafRef.current) cancelAnimationFrame(srRafRef.current);
  }, []);

  // Move focus to the Objectives dialog title when it opens so screen
  // readers announce the dialog's purpose instead of landing on the close
  // button. Two nested RAFs are required: Base UI runs its own focus
  // management on open (focusing the close button) which may itself use a
  // single RAF, so one RAF is not enough to reliably win.
  useEffect(() => {
    if (!showObjectives) return;
    let cancelled = false;
    const id = requestAnimationFrame(() => {
      if (cancelled) return;
      requestAnimationFrame(() => {
        if (!cancelled) objectivesTitleRef.current?.focus();
      });
    });
    return () => { cancelled = true; cancelAnimationFrame(id); };
  }, [showObjectives]);

  useEffect(() => {
    if (!lesson) return;
    let cancelled = false;

    (async () => {
      const existing = await engine.resumeLesson(lessonGroupId);

      if (existing.messages.length > 0) {
        setMessages(existing.messages);
        setLessonKB(existing.lessonKB);
        setPhase(existing.phase);
      } else {
        setLoading('starting');
        setStreamingText('');
        try {
          const result = await engine.startLesson(
            lessonGroupId, lesson,
            (partial) => { if (!cancelled) setStreamingText(partial); }
          );
          if (cancelled) return;
          setLessonKB(result.lessonKB);
          pendingAfterStreamRef.current = { msgs: result.messages, p: result.phase };
          setStreamingText(null);
        } catch (e) {
          if (!cancelled) { setError(e.message || 'Failed to start lesson.'); setLoading(''); setStreamingText(null); }
        }
      }
    })();

    return () => { cancelled = true; };
  }, [lessonGroupId, lesson]);

  const handleSend = useCallback(({ text, imageDataUrl }) => {
    if (!text && !imageDataUrl) return false;

    const linkPolicy = getLinkAnswerPolicy(text || '');
    if (linkPolicy.blocked) {
      setError(linkPolicy.message);
      setLinkNotice('');
      return false;
    }

    setError('');
    setLinkNotice(linkPolicy.message);
    setLoading('qa');
    setStreamingText('');

    setMessages(prev => [...prev, {
      role: 'user', content: text || '', msgType: MSG_TYPES.USER,
      phase: LESSON_PHASES.LEARNING,
      metadata: imageDataUrl ? { imageDataUrl } : null,
      timestamp: Date.now(),
    }]);

    (async () => {
      try {
        const result = await engine.sendMessage(
          lessonGroupId, lesson, text, imageDataUrl,
          (partial) => setStreamingText(partial)
        );
        const assistantMsg = result.messages.find(m => m.role === 'assistant');
        pendingAfterStreamRef.current = { msgs: assistantMsg ? [assistantMsg] : [], p: result.phase, confetti: result.achieved };
        setStreamingText(null);

        const freshKB = await getLessonKB(lessonGroupId);
        setLessonKB(freshKB);
        setLinkNotice('');
      } catch (e) {
        setError(e.message || 'Failed to send.');
        setLinkNotice('');
        setStreamingText(null);
        setLoading('');
      }
    })();

    return true;
  }, [lessonGroupId, lesson]);

  const isCustomLesson = lessonGroupId?.startsWith('custom-');
  const linkGuidance = getLinkSubmissionGuidance(composeText);

  const handleExport = useCallback(async () => {
    const markdown = await getUserLessonMarkdown(lessonGroupId);
    if (!markdown) return;
    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${lesson?.name || 'lesson'}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [lessonGroupId, lesson]);

  const handleReset = () => {
    setConfirmModal({
      title: 'Reset Lesson?',
      message: "This will delete all progress. You'll start from scratch.",
      confirmLabel: 'Reset Lesson',
      onConfirm: async () => { await deleteLessonProgress(lessonGroupId); navigate('/lessons'); },
    });
  };

  const handleDelete = () => {
    setConfirmModal({
      title: 'Delete Lesson?',
      message: 'This will permanently delete this lesson and all its progress.',
      confirmLabel: 'Delete Lesson',
      onConfirm: async () => {
        await deleteLessonProgress(lessonGroupId);
        await deleteUserLesson(lessonGroupId);
        invalidateLessonsCache();
        dispatch({ type: 'REFRESH_LESSONS', lessons: await loadLessons() });
        navigate('/lessons');
      },
    });
  };

  if (!state.loaded) return <div className="flex items-center justify-center py-12 text-muted-foreground" role="status" aria-live="polite">Loading...</div>;
  if (!lesson) return <p className="p-4 text-muted-foreground">Lesson not found.</p>;
  const busy = !!loading;
  const composePlaceholder = phase === LESSON_PHASES.COMPLETED
    ? 'Share feedback about this lesson...'
    : 'Chat with your coach...';

  const renderMessage = (msg, idx) => {
    switch (msg.msgType) {
      case MSG_TYPES.GUIDE:
        return <AssistantMessage key={idx} content={msg.content} />;
      case MSG_TYPES.USER:
        return (
          <div key={idx}>
            {msg.content && <UserMessage content={msg.content} />}
            {msg.metadata?.imageDataUrl && (
              <div className="flex justify-end mt-1">
                <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary p-1.5">
                  <img src={msg.metadata.imageDataUrl} alt="Your uploaded work" className="max-w-full rounded-lg" />
                </div>
              </div>
            )}
          </div>
        );
      default:
        return <AssistantMessage key={idx} content={msg.content} />;
    }
  };

  return (
    <div className="flex flex-col min-h-[calc(100vh-theme(spacing.20))]">
      {/* Fixed header clone — appears when inline header scrolls out of view */}
      {headerPinned && (
        <div id="lesson-header-pinned" aria-hidden="true" className="fixed top-0 left-0 right-0 z-50 border-b border-border bg-background px-4 py-2 shadow-md">
          <div className="mx-auto max-w-5xl flex items-center gap-2">
            <Button variant="ghost" size="icon-sm" aria-label="Back to lessons" onClick={() => navigate('/lessons')}>
              &larr;
            </Button>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold truncate">{lesson.name}</h2>
                <button
                  className="text-xs text-primary hover:underline shrink-0 cursor-pointer"
                  onClick={() => setShowObjectives(true)}
                >
                  Lesson Overview ({lesson.learningObjectives.length} Objectives)
                </button>
              </div>
              <ProgressBar lessonKB={lessonKB} />
            </div>
            {isCustomLesson && (
              <Button variant="ghost" size="icon-sm" onClick={handleExport} title="Export lesson markdown">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              </Button>
            )}
            {phase && (
              <Button variant="ghost" size="icon-sm" onClick={handleReset} title="Reset lesson">
                &#8635;
              </Button>
            )}
            {isCustomLesson && (
              <Button variant="ghost" size="icon-sm" onClick={handleDelete} title="Delete lesson">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Inline header — observed for scroll position */}
      <div ref={headerRef} id="lesson-header" className="border-b border-border bg-background px-4 py-2">
        <div className="mx-auto max-w-5xl flex items-center gap-2">
          <Button variant="ghost" size="icon-sm" aria-label="Back to lessons" onClick={() => navigate('/lessons')}>
            &larr;
          </Button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold truncate">{lesson.name}</h2>
              <button
                className="text-xs text-primary hover:underline shrink-0 cursor-pointer"
                onClick={() => setShowObjectives(true)}
                aria-label={`View ${lesson.learningObjectives.length} objectives`}
              >
                Lesson Overview ({lesson.learningObjectives.length} Objectives)
              </button>
            </div>
            <ProgressBar lessonKB={lessonKB} />
          </div>
          {isCustomLesson && (
            <Button variant="ghost" size="icon-sm" onClick={handleExport} aria-label="Export lesson" title="Export lesson markdown">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            </Button>
          )}
          {phase && (
            <Button variant="ghost" size="icon-sm" onClick={handleReset} aria-label="Reset lesson" title="Reset lesson">
              &#8635;
            </Button>
          )}
          {isCustomLesson && (
            <Button variant="ghost" size="icon-sm" onClick={handleDelete} aria-label="Delete lesson" title="Delete lesson">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1">
      <ChatArea ref={chatAreaRef} scrollTrigger={`${messages.length}-${displayText?.length ?? ''}`} announcement={srAnnouncement}>
        {messages.map(renderMessage)}
        {displayText != null && displayText.length > 0 && (
          <AssistantMessage content={displayText} streaming />
        )}
        {loading === 'starting' && !displayText && <ThinkingSpinner text="Setting up your lesson..." />}
        {loading === 'qa' && !displayText && <ThinkingSpinner />}
        {linkNotice && <div className="px-3 py-2 text-sm text-muted-foreground" role="status">{linkNotice}</div>}
        {error && <div className="px-3 py-2 text-sm text-destructive" role="alert">{error}</div>}
      </ChatArea>
      </div>

      {/* Inline compose — always in document flow for layout; invisible when pinned */}
      {phase && (
        <div ref={composeAnchorRef} aria-hidden={composePinned || undefined} className={composePinned ? 'invisible' : ''}>
          <ComposeBar
            placeholder={composePlaceholder}
            onSend={handleSend}
            disabled={busy}
            allowImages
            text={composeText}
            onTextChange={setComposeText}
            image={composeImage}
            onImageChange={setComposeImage}
            linkGuidance={linkGuidance}
          />
        </div>
      )}

      {/* Fixed compose overlay — interactive when pinned */}
      {phase && composePinned && (
        <div className="fixed bottom-9 left-0 right-0 z-50">
          <ComposeBar
            placeholder={composePlaceholder}
            onSend={handleSend}
            disabled={busy}
            allowImages
            elevated
            text={composeText}
            onTextChange={setComposeText}
            image={composeImage}
            onImageChange={setComposeImage}
            linkGuidance={linkGuidance}
          />
        </div>
      )}

      {/* Objectives dialog */}
      <Dialog open={showObjectives} onOpenChange={setShowObjectives}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle ref={objectivesTitleRef} tabIndex={-1}>{lesson.name}</DialogTitle>
            {lesson.description && <DialogDescription>{lesson.description}</DialogDescription>}
          </DialogHeader>
          <div className="space-y-2">
            <h3 className="text-sm font-medium">Exemplar</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">{lesson.exemplar}</p>
          </div>
          <div className="space-y-2">
            <h3 className="text-sm font-medium">Learning Objectives</h3>
            <ul className="list-disc pl-5 text-sm text-muted-foreground leading-relaxed space-y-1">
              {lesson.learningObjectives.map((obj, i) => (
                <li key={i}>{obj}</li>
              ))}
            </ul>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowObjectives(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {confirmModal && (
        <ConfirmModal
          open={!!confirmModal}
          onOpenChange={(open) => { if (!open) setConfirmModal(null); }}
          title={confirmModal.title}
          message={confirmModal.message}
          confirmLabel={confirmModal.confirmLabel}
          onConfirm={() => { setConfirmModal(null); confirmModal.onConfirm(); }}
        />
      )}
    </div>
  );
}
