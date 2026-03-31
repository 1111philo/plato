import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../contexts/AppContext.jsx';
import { useStreamedText } from '../hooks/useStreamedText.js';
import { MSG_TYPES } from '../lib/constants.js';
import { loadCourses } from '../../js/courseOwner.js';
import * as creation from '../lib/courseCreationEngine.js';

import ConfirmModal from '../components/modals/ConfirmModal.jsx';
import ChatArea from '../components/chat/ChatArea.jsx';
import ThinkingSpinner from '../components/chat/ThinkingSpinner.jsx';
import UserMessage from '../components/chat/UserMessage.jsx';
import AssistantMessage from '../components/chat/AssistantMessage.jsx';
import ComposeBar from '../components/chat/ComposeBar.jsx';
import { Button } from '@/components/ui/button';

export default function CourseCreate() {
  const navigate = useNavigate();
  const { dispatch } = useApp();

  const [messages, setMessages] = useState([]);
  const [draftId, setDraftId] = useState(null);
  const [readiness, setReadiness] = useState(0);
  const [loading, setLoading] = useState('');
  const [error, setError] = useState('');

  const [streamingText, setStreamingText] = useState(null);
  const displayText = useStreamedText(streamingText);
  const pendingAfterStreamRef = useRef(null);

  // Confirm modal state
  const [confirmModal, setConfirmModal] = useState(null);

  useEffect(() => {
    if (displayText === null && pendingAfterStreamRef.current) {
      const { msgs, r } = pendingAfterStreamRef.current;
      pendingAfterStreamRef.current = null;
      if (msgs) setMessages(prev => [...prev, ...msgs]);
      if (r != null) setReadiness(r);
      setLoading('');
    }
  }, [displayText]);

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

  const handleReset = () => {
    setConfirmModal({
      title: 'Start Over?',
      message: 'This will delete your current draft and start a new course from scratch.',
      confirmLabel: 'Start Over',
      onConfirm: async () => {
        if (draftId) await creation.deleteDraft(draftId);
        setMessages([]);
        setDraftId(null);
        setReadiness(0);
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
      },
    });
  };

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
    <div className="flex flex-col h-full">
      <div
        className="px-4 py-2"
        style={{
          backgroundColor: 'var(--classroom-header-bg, var(--color-primary))',
          color: 'var(--classroom-header-text, var(--color-primary-foreground))',
        }}
      >
        <div className="mx-auto max-w-5xl flex items-center gap-2">
          <button type="button" className="text-inherit opacity-80 hover:opacity-100 hover:bg-white/10 cursor-pointer bg-transparent border-none rounded-md p-1" aria-label="Back to courses" onClick={() => navigate('/courses')}>
            &larr;
          </button>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold truncate">Create Course</h2>
          </div>
          {draftId && (
            <button type="button" className="text-inherit opacity-80 hover:opacity-100 hover:bg-white/10 cursor-pointer bg-transparent border-none rounded-md p-1" onClick={handleReset} aria-label="Start over" title="Start over">
              &#8635;
            </button>
          )}
        </div>
      </div>

      {draftId && (
        <div className="border-b border-border px-4 py-2">
        <div className="mx-auto max-w-5xl flex items-center gap-3">
          <div
            className="flex-1"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={10}
            aria-valuenow={readiness}
            aria-label={`Course readiness: ${readiness} out of 10`}
          >
            <div className="flex justify-between text-xs text-muted-foreground mb-1" aria-hidden="true">
              <span>Not ready</span>
              <span>Ready</span>
            </div>
            <div className="h-1 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all duration-500"
                style={{ width: `${readiness * 10}%` }}
              />
            </div>
          </div>
          <Button
            size="sm"
            onClick={() => {
              if (canCreate) {
                handleCreate();
              } else {
                setConfirmModal({
                  title: 'Create course now?',
                  message: 'Continuing the conversation would strengthen your course. Create anyway?',
                  confirmLabel: 'Create Anyway',
                  variant: 'default',
                  onConfirm: handleCreate,
                });
              }
            }}
            disabled={busy}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Create Course
          </Button>
        </div>
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
        {error && <div className="px-3 py-2 text-sm text-destructive" role="alert">{error}</div>}
      </ChatArea>

      <ComposeBar
        placeholder="Describe what you want to teach..."
        onSend={handleSend}
        disabled={busy}
      />

      {confirmModal && (
        <ConfirmModal
          open={!!confirmModal}
          onOpenChange={(open) => { if (!open) setConfirmModal(null); }}
          title={confirmModal.title}
          message={confirmModal.message}
          confirmLabel={confirmModal.confirmLabel}
          variant={confirmModal.variant}
          onConfirm={() => { setConfirmModal(null); confirmModal.onConfirm(); }}
        />
      )}
    </div>
  );
}
