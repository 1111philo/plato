import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { adminApi } from './adminApi.js';
import { parseCoursePrompt } from '../../../js/courseOwner.js';
import * as orchestrator from '../../../js/orchestrator.js';
import { buildContext, parseCoachResponse, cleanStream } from '../../lib/courseEngine.js';
import { useStreamedText } from '../../hooks/useStreamedText.js';
import { COURSE_PHASES, MSG_TYPES, MAX_EXCHANGES } from '../../lib/constants.js';

import ChatArea from '../../components/chat/ChatArea.jsx';
import ComposeBar from '../../components/chat/ComposeBar.jsx';
import AssistantMessage from '../../components/chat/AssistantMessage.jsx';
import UserMessage from '../../components/chat/UserMessage.jsx';
import ThinkingSpinner from '../../components/chat/ThinkingSpinner.jsx';
import ProgressBar from '../../components/chat/ProgressBar.jsx';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export default function AdminCoursePreview() {
  const { courseId } = useParams();
  const navigate = useNavigate();

  const [course, setCourse] = useState(null);
  const [courseKB, setCourseKB] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState('');
  const [error, setError] = useState('');
  const [isDraft, setIsDraft] = useState(false);

  const [streamingText, setStreamingText] = useState(null);
  const displayText = useStreamedText(streamingText);
  const pendingRef = useRef(null);

  useEffect(() => {
    document.title = 'Preview Course — Admin';
  }, []);

  // Handle stream drain completing
  useEffect(() => {
    if (displayText === null && pendingRef.current) {
      const { msgs, kb, p } = pendingRef.current;
      pendingRef.current = null;
      if (msgs) setMessages(prev => [...prev, ...msgs]);
      if (kb) setCourseKB(kb);
      setLoading('');
    }
  }, [displayText]);

  // Load course and start preview
  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading('starting');
      setStreamingText('');
      try {
        const data = await adminApi('GET', `/v1/admin/courses/${encodeURIComponent(courseId)}`);
        if (cancelled) return;
        const parsed = parseCoursePrompt(courseId, data.markdown);
        setCourse(parsed);
        setIsDraft(data.status === 'draft');

        // Initialize KB in-memory (no persistence)
        const kb = await orchestrator.initializeCourseKB(parsed, 'Preview user — no real profile.');
        if (cancelled) return;
        kb.courseId = courseId;
        kb.name = parsed.name;
        kb.progress = 0;
        kb.activitiesCompleted = 0;
        setCourseKB(kb);

        // Start coaching conversation
        const context = buildContext(parsed, kb, 'Preview user — no real profile.', 'Preview User');
        const coachMsg = await orchestrator.converseStream(
          'coach',
          [{ role: 'user', content: context }, { role: 'assistant', content: 'Ready.' }, { role: 'user', content: 'Start the course.' }],
          cleanStream((partial) => { if (!cancelled) setStreamingText(partial); }),
          512
        );
        if (cancelled) return;

        const { text, progress, kbUpdate } = parseCoachResponse(coachMsg);
        const updatedKB = { ...kb };
        if (progress != null) updatedKB.progress = progress;
        if (kbUpdate?.insights?.length) updatedKB.insights = [...(updatedKB.insights || []), ...kbUpdate.insights];

        const msg = { role: 'assistant', content: text, msgType: MSG_TYPES.GUIDE, phase: COURSE_PHASES.LEARNING, timestamp: Date.now() };
        pendingRef.current = { msgs: [msg], kb: updatedKB };
        setStreamingText(null);
      } catch (e) {
        if (!cancelled) { setError(e.message || 'Failed to load course.'); setLoading(''); setStreamingText(null); }
      }
    })();

    return () => { cancelled = true; };
  }, [courseId]);

  const messagesRef = useRef(messages);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  const courseKBRef = useRef(courseKB);
  useEffect(() => { courseKBRef.current = courseKB; }, [courseKB]);

  const handleSend = useCallback(async ({ text }) => {
    if (!text?.trim() || !course) return;
    setError('');
    setLoading('qa');
    setStreamingText('');

    const userMsg = { role: 'user', content: text, msgType: MSG_TYPES.USER, phase: COURSE_PHASES.LEARNING, timestamp: Date.now() };
    setMessages(prev => [...prev, userMsg]);

    try {
      const kb = courseKBRef.current;
      const tail = [...messagesRef.current, userMsg].slice(-15).map(m => ({ role: m.role, content: m.content }));
      const context = buildContext(course, kb, 'Preview user — no real profile.', 'Preview User');
      const apiMessages = [{ role: 'user', content: context }, { role: 'assistant', content: 'Ready.' }, ...tail];

      const coachMsg = await orchestrator.converseStream(
        'coach',
        apiMessages,
        cleanStream((partial) => setStreamingText(partial)),
        512
      );

      const parsed = parseCoachResponse(coachMsg);
      const updatedKB = { ...kb };
      if (parsed.kbUpdate?.insights?.length) {
        updatedKB.insights = [...(updatedKB.insights || []), ...parsed.kbUpdate.insights].slice(-10);
      }
      if (parsed.kbUpdate?.learnerPosition) updatedKB.learnerPosition = parsed.kbUpdate.learnerPosition;
      if (parsed.progress != null) updatedKB.progress = parsed.progress;
      updatedKB.activitiesCompleted = (updatedKB.activitiesCompleted || 0) + 1;

      const assistantMsg = { role: 'assistant', content: parsed.text, msgType: MSG_TYPES.GUIDE, phase: COURSE_PHASES.LEARNING, timestamp: Date.now() };
      pendingRef.current = { msgs: [assistantMsg], kb: updatedKB };
      setStreamingText(null);
    } catch (e) {
      setError(e.message || 'Failed to send.');
      setStreamingText(null);
      setLoading('');
    }
  }, [course]);

  async function handlePublish() {
    try {
      await adminApi('PUT', `/v1/admin/courses/${encodeURIComponent(courseId)}`, { status: 'published' });
      navigate('/plato/courses');
    } catch (e) { setError(e.message || 'Failed to publish.'); }
  }

  const renderMessage = (msg, idx) => {
    if (msg.msgType === MSG_TYPES.USER) return <UserMessage key={idx} content={msg.content} />;
    return <AssistantMessage key={idx} content={msg.content} />;
  };

  const busy = !!loading;

  return (
    <main className="flex flex-col h-full" aria-label="Course preview">
      {/* Preview banner */}
      <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-center text-sm text-amber-800" role="status" aria-live="polite">
        Preview Mode — this conversation is not saved
      </div>

      {/* Header */}
      <header className="border-b border-border bg-background px-4 py-2">
        <nav className="mx-auto max-w-5xl flex items-center gap-2" aria-label="Course preview navigation">
          <Button variant="ghost" size="icon-sm" aria-label="Back to courses" onClick={() => navigate('/plato/courses')}>
            &larr;
          </Button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-semibold truncate">{course?.name || 'Loading...'}</h1>
              {isDraft && <Badge variant="outline" className="text-xs">Draft</Badge>}
            </div>
            <ProgressBar courseKB={courseKB} />
          </div>
          {isDraft && (
            <Button size="sm" onClick={handlePublish} aria-label={`Publish ${course?.name || 'course'} — make visible to learners`}>Publish</Button>
          )}
        </nav>
      </header>

      {/* Chat area */}
      <ChatArea courseName={course?.name}>
        {messages.map(renderMessage)}
        {displayText != null && displayText.length > 0 && (
          <AssistantMessage content={displayText} />
        )}
        {loading === 'starting' && !displayText && <ThinkingSpinner text="Setting up preview..." />}
        {loading === 'qa' && !displayText && <ThinkingSpinner />}
        {error && <div className="px-3 py-2 text-sm text-destructive" role="alert" aria-live="assertive">{error}</div>}
      </ChatArea>

      {/* Compose bar — only show once course is loaded */}
      {course && (
        <ComposeBar
          placeholder="Try chatting as a learner..."
          onSend={handleSend}
          disabled={busy}
        />
      )}
    </main>
  );
}
