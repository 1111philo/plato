import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useApp } from '../contexts/AppContext.jsx';
import { useModal } from '../contexts/ModalContext.jsx';
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

export default function CourseChat() {
  const { courseGroupId } = useParams();
  const navigate = useNavigate();
  const { state, dispatch } = useApp();
  const { courses } = state;
  const { show: showModal } = useModal();
  const course = courses.find(c => c.courseId === courseGroupId);

  const [phase, setPhase] = useState(null);
  const [messages, setMessages] = useState([]);
  const [courseKB, setCourseKB] = useState(null);
  const [loading, setLoading] = useState('');
  const [error, setError] = useState('');

  const [streamingText, setStreamingText] = useState(null);
  const displayText = useStreamedText(streamingText);
  const pendingAfterStreamRef = useRef(null);

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

  // -- Load on mount ----------------------------------------------------------

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

  // -- Send message -----------------------------------------------------------

  const handleSend = useCallback(async ({ text, imageDataUrl }) => {
    if (!text && !imageDataUrl) return;
    setError('');
    setLoading('qa');
    setStreamingText('');

    // Show user message immediately (with image preview if attached)
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

  // -- Export / Reset / Delete ------------------------------------------------

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
    showModal(
      <ConfirmModal
        title="Reset Course?"
        message="This will delete all progress. You'll start from scratch."
        confirmLabel="Reset Course"
        onConfirm={async () => { await deleteCourseProgress(courseGroupId); navigate('/courses'); }}
      />,
      'alertdialog',
      'Reset course'
    );
  };

  const handleDelete = () => {
    showModal(
      <ConfirmModal
        title="Delete Course?"
        message="This will permanently delete this course and all its progress."
        confirmLabel="Delete Course"
        onConfirm={async () => {
          await deleteCourseProgress(courseGroupId);
          await deleteUserCourse(courseGroupId);
          invalidateCoursesCache();
          dispatch({ type: 'REFRESH_COURSES', courses: await loadCourses() });
          navigate('/courses');
        }}
      />,
      'alertdialog',
      'Delete course'
    );
  };

  // -- Render -----------------------------------------------------------------

  if (!course) return <p>Course not found.</p>;
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
              <div className="msg msg-user" style={{ padding: '6px', marginTop: msg.content ? '4px' : 0 }}>
                <img src={msg.metadata.imageDataUrl} alt="Your uploaded work" style={{ maxWidth: '100%', borderRadius: 'var(--radius)' }} />
              </div>
            )}
          </div>
        );
      default:
        return <AssistantMessage key={idx} content={msg.content} />;
    }
  };

  return (
    <div className="course-layout">
      <div className="course-header">
        <button className="back-btn" aria-label="Back to courses" onClick={() => navigate('/courses')}>&larr;</button>
        <div className="course-header-info">
          <h2>{course.name}</h2>
          <ProgressBar courseKB={courseKB} />
        </div>
        {isCustomCourse && (
          <button className="reset-btn" onClick={handleExport} aria-label="Export course" title="Export course markdown">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          </button>
        )}
        {phase && <button className="reset-btn" onClick={handleReset} aria-label="Reset course" title="Reset course">&#8635;</button>}
        {isCustomCourse && (
          <button className="reset-btn" onClick={handleDelete} aria-label="Delete course" title="Delete course">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        )}
      </div>

      <ChatArea courseName={course?.name}>
        {messages.map(renderMessage)}
        {displayText != null && displayText.length > 0 && (
          <AssistantMessage content={displayText} />
        )}
        {loading === 'starting' && !displayText && <ThinkingSpinner text="Setting up your course..." />}
        {loading === 'qa' && !displayText && <ThinkingSpinner />}
        {error && <div className="msg msg-response" role="alert" style={{ color: 'var(--color-warning)' }}>{error}</div>}
      </ChatArea>

      {phase && (
        <div className="course-bottom-bar">
          <ComposeBar
            placeholder={phase === COURSE_PHASES.COMPLETED ? "Continue chatting..." : "Chat with your coach..."}
            onSend={handleSend}
            disabled={busy}
            allowImages
          />
        </div>
      )}
    </div>
  );
}
