import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useApp } from '../contexts/AppContext.jsx';
import { useStreamedText } from '../hooks/useStreamedText.js';
import { COURSE_PHASES, MSG_TYPES } from '../lib/constants.js';
import { launchConfetti } from '../lib/confetti.js';
import {
  getCourseKB, deleteCourseProgress,
  getUserCourseMarkdown, deleteUserCourse,
} from '../../js/storage.js';
import { invalidateCoursesCache, loadCourses } from '../../js/courseOwner.js';
import * as engine from '../lib/courseEngine.js';

import ChatArea from '../components/chat/ChatArea.jsx';
import ThinkingSpinner from '../components/chat/ThinkingSpinner.jsx';
import UserMessage from '../components/chat/UserMessage.jsx';
import AssistantMessage from '../components/chat/AssistantMessage.jsx';
import ProgressBar from '../components/chat/ProgressBar.jsx';
import ComposeBar from '../components/chat/ComposeBar.jsx';
import ConfirmModal from '../components/modals/ConfirmModal.jsx';
import { Button } from '@/components/ui/button';

export default function CourseChat() {
  const { courseGroupId } = useParams();
  const navigate = useNavigate();
  const { state, dispatch } = useApp();
  const { courses } = state;
  const course = courses.find(c => c.courseId === courseGroupId);

  const [phase, setPhase] = useState(null);
  const [messages, setMessages] = useState([]);
  const [courseKB, setCourseKB] = useState(null);
  const [loading, setLoading] = useState('');
  const [error, setError] = useState('');

  const [streamingText, setStreamingText] = useState(null);
  const displayText = useStreamedText(streamingText);
  const pendingAfterStreamRef = useRef(null);

  // Confirm modal state
  const [confirmModal, setConfirmModal] = useState(null);

  useEffect(() => {
    if (displayText === null && pendingAfterStreamRef.current) {
      const { msgs, p, confetti } = pendingAfterStreamRef.current;
      pendingAfterStreamRef.current = null;
      if (msgs) setMessages(prev => [...prev, ...msgs]);
      if (p) setPhase(p);
      if (confetti) launchConfetti();
      setLoading('');
    }
  }, [displayText]);

  useEffect(() => {
    if (!course) return;
    let cancelled = false;

    (async () => {
      const existing = await engine.resumeCourse(courseGroupId);

      if (existing.messages.length > 0) {
        setMessages(existing.messages);
        setCourseKB(existing.courseKB);
        setPhase(existing.phase);
      } else {
        setLoading('starting');
        setStreamingText('');
        try {
          const result = await engine.startCourse(
            courseGroupId, course,
            (partial) => { if (!cancelled) setStreamingText(partial); }
          );
          if (cancelled) return;
          setCourseKB(result.courseKB);
          pendingAfterStreamRef.current = { msgs: result.messages, p: result.phase };
          setStreamingText(null);
        } catch (e) {
          if (!cancelled) { setError(e.message || 'Failed to start course.'); setLoading(''); setStreamingText(null); }
        }
      }
    })();

    return () => { cancelled = true; };
  }, [courseGroupId]);

  const handleSend = useCallback(async ({ text, imageDataUrl }) => {
    if (!text && !imageDataUrl) return;
    setError('');
    setLoading('qa');
    setStreamingText('');

    setMessages(prev => [...prev, {
      role: 'user', content: text || '', msgType: MSG_TYPES.USER,
      phase: COURSE_PHASES.LEARNING,
      metadata: imageDataUrl ? { imageDataUrl } : null,
      timestamp: Date.now(),
    }]);

    try {
      const result = await engine.sendMessage(
        courseGroupId, course, text, imageDataUrl,
        (partial) => setStreamingText(partial)
      );
      const assistantMsg = result.messages.find(m => m.role === 'assistant');
      pendingAfterStreamRef.current = { msgs: assistantMsg ? [assistantMsg] : [], p: result.phase, confetti: result.achieved };
      setStreamingText(null);

      const freshKB = await getCourseKB(courseGroupId);
      setCourseKB(freshKB);
    } catch (e) {
      setError(e.message || 'Failed to send.');
      setStreamingText(null);
      setLoading('');
    }
  }, [courseGroupId, course]);

  const isCustomCourse = courseGroupId?.startsWith('custom-');

  const handleExport = useCallback(async () => {
    const markdown = await getUserCourseMarkdown(courseGroupId);
    if (!markdown) return;
    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${course?.name || 'course'}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [courseGroupId, course]);

  const handleReset = () => {
    setConfirmModal({
      title: 'Reset Course?',
      message: "This will delete all progress. You'll start from scratch.",
      confirmLabel: 'Reset Course',
      onConfirm: async () => { await deleteCourseProgress(courseGroupId); navigate('/courses'); },
    });
  };

  const handleDelete = () => {
    setConfirmModal({
      title: 'Delete Course?',
      message: 'This will permanently delete this course and all its progress.',
      confirmLabel: 'Delete Course',
      onConfirm: async () => {
        await deleteCourseProgress(courseGroupId);
        await deleteUserCourse(courseGroupId);
        invalidateCoursesCache();
        dispatch({ type: 'REFRESH_COURSES', courses: await loadCourses() });
        navigate('/courses');
      },
    });
  };

  if (!course) return <p className="p-4 text-muted-foreground">Course not found.</p>;
  const busy = !!loading;

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
    <div className="flex flex-col h-full">
      <div className="border-b border-border px-4 py-2">
      <div className="mx-auto max-w-5xl flex items-center gap-2">
        <Button variant="ghost" size="icon-sm" aria-label="Back to courses" onClick={() => navigate('/courses')}>
          &larr;
        </Button>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold truncate">{course.name}</h2>
          <ProgressBar courseKB={courseKB} />
        </div>
        {isCustomCourse && (
          <Button variant="ghost" size="icon-sm" onClick={handleExport} aria-label="Export course" title="Export course markdown">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          </Button>
        )}
        {phase && (
          <Button variant="ghost" size="icon-sm" onClick={handleReset} aria-label="Reset course" title="Reset course">
            &#8635;
          </Button>
        )}
        {isCustomCourse && (
          <Button variant="ghost" size="icon-sm" onClick={handleDelete} aria-label="Delete course" title="Delete course">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </Button>
        )}
      </div>
      </div>

      <ChatArea courseName={course?.name}>
        {messages.map(renderMessage)}
        {displayText != null && displayText.length > 0 && (
          <AssistantMessage content={displayText} />
        )}
        {loading === 'starting' && !displayText && <ThinkingSpinner text="Setting up your course..." />}
        {loading === 'qa' && !displayText && <ThinkingSpinner />}
        {error && <div className="px-3 py-2 text-sm text-destructive" role="alert">{error}</div>}
      </ChatArea>

      {phase && (
        <ComposeBar
          placeholder={phase === COURSE_PHASES.COMPLETED ? "Continue chatting..." : "Chat with your coach..."}
          onSend={handleSend}
          disabled={busy}
          allowImages
        />
      )}

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
