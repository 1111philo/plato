import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { adminApi } from './adminApi.js';
import { parseLessonPrompt } from '../../../js/lessonOwner.js';
import * as orchestrator from '../../../js/orchestrator.js';
import { buildContext, parseCoachResponse, cleanStream } from '../../lib/lessonEngine.js';
import { useStreamedText } from '../../hooks/useStreamedText.js';
import { LESSON_PHASES, MSG_TYPES, MAX_EXCHANGES } from '../../lib/constants.js';

import ChatArea from '../../components/chat/ChatArea.jsx';
import ComposeBar from '../../components/chat/ComposeBar.jsx';
import AssistantMessage from '../../components/chat/AssistantMessage.jsx';
import UserMessage from '../../components/chat/UserMessage.jsx';
import ThinkingSpinner from '../../components/chat/ThinkingSpinner.jsx';
import ProgressBar from '../../components/chat/ProgressBar.jsx';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from '@/components/ui/dialog';

export default function AdminLessonPreview() {
  const { lessonId } = useParams();
  const navigate = useNavigate();

  const [lesson, setLesson] = useState(null);
  const [lessonKB, setLessonKB] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState('');
  const [showObjectives, setShowObjectives] = useState(false);
  const [error, setError] = useState('');
  const [isDraft, setIsDraft] = useState(false);
  const [isShared, setIsShared] = useState(false);

  const [streamingText, setStreamingText] = useState(null);
  const displayText = useStreamedText(streamingText);
  const pendingRef = useRef(null);

  useEffect(() => {
    document.title = 'Preview Lesson — Admin';
  }, []);

  // Handle stream drain completing
  useEffect(() => {
    if (displayText === null && pendingRef.current) {
      const { msgs, kb, p } = pendingRef.current;
      pendingRef.current = null;
      if (msgs) setMessages(prev => [...prev, ...msgs]);
      if (kb) setLessonKB(kb);
      setLoading('');
    }
  }, [displayText]);

  // Load lesson and start preview
  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading('starting');
      setStreamingText('');
      try {
        const data = await adminApi('GET', `/v1/admin/lessons/${encodeURIComponent(lessonId)}`);
        if (cancelled) return;
        const parsed = parseLessonPrompt(lessonId, data.markdown);
        setLesson(parsed);
        setIsDraft(data.status === 'draft');
        setIsShared(data.sharedWith?.length > 0);

        // Initialize KB in-memory (no persistence)
        const kb = await orchestrator.initializeLessonKB(parsed, 'Preview user — no real profile.');
        if (cancelled) return;
        kb.lessonId = lessonId;
        kb.name = parsed.name;
        kb.progress = 0;
        kb.activitiesCompleted = 0;
        setLessonKB(kb);

        // Start coaching conversation
        const context = buildContext(parsed, kb, 'Preview user — no real profile.', 'Preview User');
        const coachMsg = await orchestrator.converseStream(
          'coach',
          [{ role: 'user', content: context }, { role: 'assistant', content: 'Ready.' }, { role: 'user', content: 'Start the lesson.' }],
          cleanStream((partial) => { if (!cancelled) setStreamingText(partial); }),
          512
        );
        if (cancelled) return;

        const { text, progress, kbUpdate } = parseCoachResponse(coachMsg);
        const updatedKB = { ...kb };
        if (progress != null) updatedKB.progress = progress;
        if (kbUpdate?.insights?.length) updatedKB.insights = [...(updatedKB.insights || []), ...kbUpdate.insights];

        const msg = { role: 'assistant', content: text, msgType: MSG_TYPES.GUIDE, phase: LESSON_PHASES.LEARNING, timestamp: Date.now() };
        pendingRef.current = { msgs: [msg], kb: updatedKB };
        setStreamingText(null);
      } catch (e) {
        if (!cancelled) { setError(e.message || 'Failed to load lesson.'); setLoading(''); setStreamingText(null); }
      }
    })();

    return () => { cancelled = true; };
  }, [lessonId]);

  const messagesRef = useRef(messages);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  const lessonKBRef = useRef(lessonKB);
  useEffect(() => { lessonKBRef.current = lessonKB; }, [lessonKB]);

  const handleSend = useCallback(async ({ text }) => {
    if (!text?.trim() || !lesson) return;
    setError('');
    setLoading('qa');
    setStreamingText('');

    const userMsg = { role: 'user', content: text, msgType: MSG_TYPES.USER, phase: LESSON_PHASES.LEARNING, timestamp: Date.now() };
    setMessages(prev => [...prev, userMsg]);

    try {
      const kb = lessonKBRef.current;
      const tail = [...messagesRef.current, userMsg].slice(-15).map(m => ({ role: m.role, content: m.content }));
      const context = buildContext(lesson, kb, 'Preview user — no real profile.', 'Preview User');
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

      const assistantMsg = { role: 'assistant', content: parsed.text, msgType: MSG_TYPES.GUIDE, phase: LESSON_PHASES.LEARNING, timestamp: Date.now() };
      pendingRef.current = { msgs: [assistantMsg], kb: updatedKB };
      setStreamingText(null);
    } catch (e) {
      setError(e.message || 'Failed to send.');
      setStreamingText(null);
      setLoading('');
    }
  }, [lesson]);

  async function handlePublish() {
    try {
      await adminApi('PUT', `/v1/admin/lessons/${encodeURIComponent(lessonId)}`, { status: 'published' });
      navigate('/plato/lessons');
    } catch (e) { setError(e.message || 'Failed to publish.'); }
  }

  const renderMessage = (msg, idx) => {
    if (msg.msgType === MSG_TYPES.USER) return <UserMessage key={idx} content={msg.content} />;
    return <AssistantMessage key={idx} content={msg.content} />;
  };

  const busy = !!loading;

  return (
    <main className="flex flex-col h-full" aria-label="Lesson preview">
      {/* Preview banner */}
      <div className="px-4 pt-4 mb-4">
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800" role="status" aria-live="polite">
          <strong>Preview Mode</strong> — this conversation is not saved
        </div>
      </div>

      {/* Header */}
      <header className="border-b border-border bg-background px-4 py-2">
        <nav className="mx-auto max-w-5xl flex items-center gap-2" aria-label="Lesson preview navigation">
          <Button variant="ghost" size="icon-sm" aria-label="Back to lessons" onClick={() => navigate('/plato/lessons')}>
            &larr;
          </Button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <h1 className="text-sm font-semibold truncate">{lesson?.name || 'Loading...'}</h1>
                {isDraft && <Badge variant="outline" className="text-xs border-amber-300 bg-amber-50 text-amber-800">Draft</Badge>}
                {isShared && <Badge variant="outline" className="text-xs border-violet-300 bg-violet-50 text-violet-800">Shared</Badge>}
              </div>
              {lesson && (
                <button
                  className="text-xs text-primary hover:underline shrink-0 cursor-pointer"
                  onClick={() => setShowObjectives(true)}
                  aria-label={`View ${lesson.learningObjectives.length} objectives`}
                >
                  Lesson Overview ({lesson.learningObjectives.length} Objectives)
                </button>
              )}
            </div>
            <ProgressBar lessonKB={lessonKB} />
          </div>
          {isDraft && (
            <Button size="sm" onClick={handlePublish} aria-label={`Publish ${lesson?.name || 'lesson'} — make visible to learners`}>Publish</Button>
          )}
        </nav>
      </header>

      {/* Chat area */}
      <ChatArea lessonName={lesson?.name}>
        {messages.map(renderMessage)}
        {displayText != null && displayText.length > 0 && (
          <AssistantMessage content={displayText} />
        )}
        {loading === 'starting' && !displayText && <ThinkingSpinner text="Setting up preview..." />}
        {loading === 'qa' && !displayText && <ThinkingSpinner />}
        {error && <div className="px-3 py-2 text-sm text-destructive" role="alert" aria-live="assertive">{error}</div>}
      </ChatArea>

      {/* Compose bar — only show once lesson is loaded */}
      {lesson && (
        <ComposeBar
          placeholder="Try chatting as a learner..."
          onSend={handleSend}
          disabled={busy}
        />
      )}

      {/* Objectives dialog */}
      {lesson && (
        <Dialog open={showObjectives} onOpenChange={setShowObjectives}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{lesson.name}</DialogTitle>
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
      )}
    </main>
  );
}
