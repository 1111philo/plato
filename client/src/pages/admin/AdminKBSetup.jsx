import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminApi } from './adminApi.js';
import { Button } from '@/components/ui/button';

import { converseStream, extractKBMarkdown } from '../../../js/orchestrator.js';
import { parseResponse, cleanStream } from '../../lib/lessonCreationEngine.js';
import { useStreamedText } from '../../hooks/useStreamedText.js';
import { MSG_TYPES } from '../../lib/constants.js';

import ChatArea from '../../components/chat/ChatArea.jsx';
import ComposeBar from '../../components/chat/ComposeBar.jsx';
import AssistantMessage from '../../components/chat/AssistantMessage.jsx';
import UserMessage from '../../components/chat/UserMessage.jsx';
import ThinkingSpinner from '../../components/chat/ThinkingSpinner.jsx';

export default function AdminKBSetup() {
  const navigate = useNavigate();
  const [chatMessages, setChatMessages] = useState([]);
  const [readiness, setReadiness] = useState(0);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const [streamingText, setStreamingText] = useState(null);
  const displayText = useStreamedText(streamingText);
  const pendingRef = useRef(null);

  useEffect(() => {
    document.title = 'Set Up Knowledge Base — plato';
  }, []);

  useEffect(() => {
    if (displayText === null && pendingRef.current) {
      const { msgs, r } = pendingRef.current;
      pendingRef.current = null;
      if (msgs) setChatMessages(prev => [...prev, ...msgs]);
      if (r != null) setReadiness(r);
      setBusy('');
    }
  }, [displayText]);

  // Start conversation
  useEffect(() => {
    let cancelled = false;
    setBusy('starting');
    setStreamingText('');

    (async () => {
      try {
        const raw = await converseStream(
          'knowledge-base-editor',
          [{ role: 'user', content: 'I want to create a knowledge base for my program.' }],
          cleanStream((partial) => { if (!cancelled) setStreamingText(partial); }),
          512
        );
        if (cancelled) return;
        const { text, readiness: r } = parseResponse(raw);
        const msg = { role: 'assistant', content: text, msgType: MSG_TYPES.GUIDE, timestamp: Date.now() };
        pendingRef.current = { msgs: [msg], r: r ?? 1 };
        setStreamingText(null);
      } catch (e) {
        if (!cancelled) { setError(e.message || 'Failed to start.'); setBusy(''); setStreamingText(null); }
      }
    })();

    return () => { cancelled = true; };
  }, []);

  const chatMessagesRef = useRef(chatMessages);
  useEffect(() => { chatMessagesRef.current = chatMessages; }, [chatMessages]);

  const handleSend = useCallback(async ({ text }) => {
    if (!text?.trim()) return;
    setError('');
    setBusy('qa');
    setStreamingText('');

    const userMsg = { role: 'user', content: text, msgType: MSG_TYPES.USER, timestamp: Date.now() };
    setChatMessages(prev => [...prev, userMsg]);

    try {
      const tail = [...chatMessagesRef.current, userMsg].slice(-15).map(m => ({ role: m.role, content: m.content }));
      const raw = await converseStream(
        'knowledge-base-editor',
        tail,
        cleanStream((partial) => setStreamingText(partial)),
        512
      );
      const { text: respText, readiness: r } = parseResponse(raw);
      const assistantMsg = { role: 'assistant', content: respText, msgType: MSG_TYPES.GUIDE, timestamp: Date.now() };
      pendingRef.current = { msgs: [assistantMsg], r };
      setStreamingText(null);
    } catch (e) {
      setError(e.message || 'Failed to send.');
      setStreamingText(null);
      setBusy('');
    }
  }, []);

  async function handleSaveKB() {
    setError('');
    setBusy('creating');
    try {
      const conversationText = chatMessages.map(m => `${m.role === 'user' ? 'User' : 'Agent'}: ${m.content}`).join('\n\n');
      const md = await extractKBMarkdown(conversationText);
      if (!md || md.length < 50) {
        setError('Could not generate a knowledge base from the conversation. Keep adding information.');
        setBusy('');
        return;
      }
      const conversation = chatMessages.map(m => ({ role: m.role, content: m.content, msgType: m.msgType }));
      await adminApi('PUT', '/v1/admin/knowledge-base', { content: md, conversation, readiness });
      navigate('/plato');
    } catch (e) {
      setError(e.message || 'Failed to save.');
      setBusy('');
    }
  }

  const isBusy = !!busy;

  const renderMessage = (msg, idx) => {
    if (msg.msgType === MSG_TYPES.USER) return <UserMessage key={idx} content={msg.content} />;
    return <AssistantMessage key={idx} content={msg.content} />;
  };

  return (
    <main className="max-w-2xl mx-auto p-6" aria-label="Knowledge base setup">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-bold">Set Up Your Knowledge Base</h1>
        <Button variant="ghost" size="sm" onClick={() => navigate('/plato')}>Skip for now</Button>
      </div>
      <p className="text-sm text-muted-foreground mb-6">
        The knowledge base tells plato's AI about your program — who you are, what you do, and how things work.
        Chat with the editor below to build it, or skip and come back later from the Customizer.
      </p>

      {error && (
        <div className="flex items-center justify-between rounded-lg bg-destructive/10 text-destructive px-4 py-3 mb-4 text-sm" role="alert" aria-live="assertive">
          <span>{error}</span>
          <button onClick={() => setError('')} aria-label="Dismiss error" className="ml-2 text-lg leading-none hover:opacity-70">&times;</button>
        </div>
      )}

      {(chatMessages.length > 0 || displayText != null) && (
        <div className="flex items-end gap-4 mb-4">
          <div
            className="flex-1"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={10}
            aria-valuenow={readiness}
            aria-label={`Knowledge base readiness: ${readiness} out of 10`}
          >
            <div className="flex justify-between text-xs text-muted-foreground mb-1" aria-hidden="true">
              <span>Not ready</span>
              <span>Ready</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${readiness * 10}%`,
                  backgroundColor: `hsl(${readiness * 12}, 80%, 45%)`,
                }}
              />
            </div>
          </div>
          <Button onClick={handleSaveKB} disabled={isBusy || readiness < 3} size="sm"
            title={readiness < 3 ? 'Tell the editor about your classroom goal, learners, and teachers first' : undefined}>
            {busy === 'creating' ? 'Saving...' : 'Save Knowledge Base'}
          </Button>
        </div>
      )}

      <div className="rounded-2xl bg-muted/40 border border-border p-4">
        <div className="mb-3">
          <ChatArea lessonName="Knowledge Base Editor">
            {chatMessages.map(renderMessage)}
            {displayText != null && displayText.length > 0 && (
              <AssistantMessage content={displayText} />
            )}
            {busy === 'starting' && !displayText && <ThinkingSpinner text="Starting..." />}
            {busy === 'creating' && <ThinkingSpinner text="Generating knowledge base..." />}
            {busy === 'qa' && !displayText && <ThinkingSpinner />}
          </ChatArea>
        </div>

        <ComposeBar
          placeholder="Tell me about your program..."
          onSend={handleSend}
          disabled={isBusy}
        />
      </div>
    </main>
  );
}
