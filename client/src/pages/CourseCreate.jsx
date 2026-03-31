import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../contexts/AppContext.jsx';
import { useStreamedText } from '../hooks/useStreamedText.js';
import { MSG_TYPES } from '../lib/constants.js';
import { loadCourses } from '../../js/courseOwner.js';
import * as creation from '../lib/courseCreationEngine.js';

import { useModal } from '../contexts/ModalContext.jsx';
import ConfirmModal from '../components/modals/ConfirmModal.jsx';
import ChatArea from '../components/chat/ChatArea.jsx';
import ThinkingSpinner from '../components/chat/ThinkingSpinner.jsx';
import UserMessage from '../components/chat/UserMessage.jsx';
import AssistantMessage from '../components/chat/AssistantMessage.jsx';
import ComposeBar from '../components/chat/ComposeBar.jsx';

export default function CourseCreate() {
  const navigate = useNavigate();
  const { dispatch } = useApp();
  const { show: showModal } = useModal();

  const [messages, setMessages] = useState([]);
  const [draftId, setDraftId] = useState(null);
  const [readiness, setReadiness] = useState(0);
  const [loading, setLoading] = useState('');
  const [error, setError] = useState('');

  const [streamingText, setStreamingText] = useState(null);
  const displayText = useStreamedText(streamingText);
  const pendingAfterStreamRef = useRef(null);

  useEffect(() => {
    if (displayText === null && pendingAfterStreamRef.current) {
      const { msgs, r } = pendingAfterStreamRef.current;
      pendingAfterStreamRef.current = null;
      if (msgs) setMessages(prev => [...prev, ...msgs]);
      if (r != null) setReadiness(r);
      setLoading('');
    }
  }, [displayText]);

  // -- Load on mount: resume draft or start new --------------------------------

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const existingDraftId = await creation.getDraftCourseId();

      if (existingDraftId) {
        const result = await creation.resumeDraft(existingDraftId);
        if (!cancelled) {
          setDraftId(result.draftId);
          setMessages(result.messages);
          setReadiness(result.readiness);
        }
      } else {
        setLoading('starting');
        setStreamingText('');
        try {
          const result = await creation.startCreation(
            (partial) => { if (!cancelled) setStreamingText(partial); }
          );
          if (cancelled) return;
          setDraftId(result.draftId);
          pendingAfterStreamRef.current = { msgs: result.messages, r: result.readiness };
          setStreamingText(null);
        } catch (e) {
          if (!cancelled) { setError(e.message || 'Failed to start.'); setLoading(''); setStreamingText(null); }
        }
      }
    })();

    return () => { cancelled = true; };
  }, []);

  // -- Send message -------------------------------------------------------------

  const handleSend = useCallback(async ({ text }) => {
    if (!text?.trim() || !draftId) return;
    setError('');
    setLoading('qa');
    setStreamingText('');
    setMessages(prev => [...prev, { role: 'user', content: text, msgType: MSG_TYPES.USER, phase: 'creating', timestamp: Date.now() }]);

    try {
      const result = await creation.sendMessage(draftId, text,
        (partial) => setStreamingText(partial));
      const assistantMsg = result.messages.find(m => m.role === 'assistant');
      pendingAfterStreamRef.current = { msgs: assistantMsg ? [assistantMsg] : [], r: result.readiness };
      setStreamingText(null);
    } catch (e) {
      setError(e.message || 'Failed to send.');
      setStreamingText(null);
      setLoading('');
    }
  }, [draftId]);

  // -- Create course ------------------------------------------------------------

  const handleCreate = useCallback(async () => {
    if (!draftId) return;
    setError('');
    setLoading('creating');

    try {
      const result = await creation.createCourse(draftId);

      if (result.error) {
        setError(result.error);
        setLoading('');
        return;
      }

      // Refresh courses in app state
      const courses = await loadCourses();
      dispatch({ type: 'REFRESH_COURSES', courses });
      setLoading('');
      navigate('/courses');
    } catch (e) {
      setError(e.message || 'Failed to create course.');
      setStreamingText(null);
      setLoading('');
    }
  }, [draftId, dispatch, navigate]);

  // -- Reset draft --------------------------------------------------------------

  const handleReset = () => {
    showModal(
      <ConfirmModal
        title="Start Over?"
        message="This will delete your current draft and start a new course from scratch."
        confirmLabel="Start Over"
        onConfirm={async () => {
          if (draftId) await creation.deleteDraft(draftId);
          setMessages([]);
          setDraftId(null);
          setReadiness(0);
          // Start fresh
          setLoading('starting');
          setStreamingText('');
          try {
            const result = await creation.startCreation(
              (partial) => setStreamingText(partial));
            setDraftId(result.draftId);
            pendingAfterStreamRef.current = { msgs: result.messages, r: result.readiness };
            setStreamingText(null);
          } catch (e) {
            setError(e.message || 'Failed to restart.');
            setLoading('');
            setStreamingText(null);
          }
        }}
      />
    );
  };

  // -- Render -------------------------------------------------------------------

  const busy = !!loading;
  const hasUserMessage = messages.some(m => m.role === 'user');
  const canCreate = readiness >= 7 && !busy;

  const renderMessage = (msg, idx) => {
    switch (msg.msgType) {
      case MSG_TYPES.GUIDE:
        return <AssistantMessage key={idx} content={msg.content} />;
      case MSG_TYPES.USER:
        return <UserMessage key={idx} content={msg.content} />;
      default:
        return <AssistantMessage key={idx} content={msg.content} />;
    }
  };

  return (
    <div className="course-layout">
      <div className="course-header">
        <button className="back-btn" aria-label="Back to courses" onClick={() => navigate('/courses')}>&larr;</button>
        <div className="course-header-info">
          <h2>Create Course</h2>
        </div>
        {draftId && <button className="reset-btn" onClick={handleReset} aria-label="Start over" title="Start over">&#8635;</button>}
      </div>

      {/* Readiness panel — between header and chat */}
      {hasUserMessage && (
        <div className="creation-panel">
          <div
            className="creation-meter"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={10}
            aria-valuenow={readiness}
            aria-label={`Course readiness: ${readiness} out of 10`}
          >
            <div className="creation-meter-labels" aria-hidden="true">
              <span>Not ready</span>
              <span>Ready</span>
            </div>
            <div className="creation-meter-track">
              <div className="creation-meter-overlay" style={{ width: `${100 - readiness * 10}%` }} />
            </div>
          </div>
          <button
            className="primary-btn action-icon-btn create-course-btn"
            onClick={() => {
              if (canCreate) {
                handleCreate();
              } else {
                showModal(
                  <ConfirmModal
                    title="Create course now?"
                    message="Continuing the conversation would strengthen your course. Create anyway?"
                    confirmLabel="Create Anyway"
                    onConfirm={handleCreate}
                  />
                );
              }
            }}
            disabled={busy}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Create Course
          </button>
        </div>
      )}

      <ChatArea courseName="Course Creator">
        {messages.map(renderMessage)}
        {displayText != null && displayText.length > 0 && (
          <AssistantMessage content={displayText} />
        )}
        {loading === 'starting' && !displayText && <ThinkingSpinner text="Starting..." />}
        {loading === 'creating' && !displayText && <ThinkingSpinner text="Generating your course..." />}
        {loading === 'qa' && !displayText && <ThinkingSpinner />}
        {error && <div className="msg msg-response" role="alert" style={{ color: 'var(--color-warning)' }}>{error}</div>}
      </ChatArea>

      <div className="course-bottom-bar">
        <ComposeBar
          placeholder="Describe what you want to teach..."
          onSend={handleSend}
          disabled={busy}
        />
      </div>
    </div>
  );
}
