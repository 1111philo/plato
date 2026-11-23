/**
 * The streaming chat behind the three admin authoring surfaces: the lesson
 * editor (AdminLessons), the Customizer's knowledge base editor, and
 * first-time knowledge base setup. They shared this logic by copy; it lives
 * here once.
 *
 * The AI call itself, and its Trace (#595), are lib/authoringEngine.js. This
 * hook owns the React state around it: the message list, the reply while it
 * streams, the readiness score, the busy flag, and the announcement for
 * screen readers.
 *
 * A reply is appended only after the streamed copy is gone (`streamingText`
 * back to null), so the two never show at once.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { authoringTurn, authoringTail } from '../lib/authoringEngine.js';
import { useTitleNotification } from './useTitleNotification.js';
import { MSG_TYPES } from '../lib/constants.js';
import { authoringActivity, AUTHORING_READS } from '../lib/agentActivity.js';

const reply = (agent, text, before, after) => ({
  role: 'assistant', content: text, msgType: MSG_TYPES.GUIDE,
  metadata: { agents: authoringActivity(agent, { before, after, reads: AUTHORING_READS }) },
  timestamp: Date.now(),
});

/**
 * @param {object} o
 * @param {string} o.agent  'lesson-creator' | 'knowledge-base-editor'
 * @param {string} o.scope  Trace scope: 'kb' or `author-<lessonId>`
 * @param {string} o.title  the page's document title (flashed on a new reply)
 * @param {object[]} [o.initialMessages] a saved conversation to resume
 * @param {number} [o.initialReadiness]
 */
export function useAuthoringChat({ agent, scope, title, initialMessages, initialReadiness }) {
  const [chatMessages, setChatMessages] = useState(initialMessages || []);
  const [readiness, setReadiness] = useState(initialReadiness ?? 0);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [streamingText, setStreamingText] = useState(null);
  const [srAnnouncement, setSrAnnouncement] = useState('');
  const pendingRef = useRef(null);
  const notifyTitle = useTitleNotification(title);

  const readinessRef = useRef(readiness);
  useEffect(() => { readinessRef.current = readiness; }, [readiness]);
  // So handleSend always has the latest messages.
  const chatMessagesRef = useRef(chatMessages);
  useEffect(() => { chatMessagesRef.current = chatMessages; }, [chatMessages]);

  // The stream finished: append the reply.
  useEffect(() => {
    if (streamingText === null && pendingRef.current) {
      const { msgs, r } = pendingRef.current;
      pendingRef.current = null;
      if (msgs) {
        setChatMessages((prev) => [...prev, ...msgs]);
        if (msgs.some((m) => m.role === 'assistant')) {
          setSrAnnouncement('');
          requestAnimationFrame(() => setSrAnnouncement('New message received'));
          notifyTitle();
        }
      }
      if (r != null) setReadiness(r);
      setBusy('');
    }
  }, [streamingText, notifyTitle]);

  /**
   * Open the conversation: send `openingMessages` and show the agent's first
   * reply. `fallbackReadiness` is used when the reply carries no score.
   * Returns a function that abandons it (for an effect's cleanup).
   */
  const start = useCallback((openingMessages, { fallbackReadiness } = {}) => {
    let cancelled = false;
    setBusy('starting');
    setStreamingText('');
    (async () => {
      try {
        const { text, readiness: r } = await authoringTurn({
          scope, agent, messages: openingMessages,
          onStream: (partial) => { if (!cancelled) setStreamingText(partial); },
        });
        if (cancelled) return;
        pendingRef.current = { msgs: [reply(agent, text, null, r)], r: r ?? fallbackReadiness };
        setStreamingText(null);
      } catch (e) {
        if (!cancelled) { setError(e.message || 'Failed to start.'); setBusy(''); setStreamingText(null); }
      }
    })();
    return () => { cancelled = true; };
  }, [agent, scope]);

  const handleSend = useCallback(async ({ text }) => {
    if (!text?.trim()) return;
    setError('');
    setBusy('qa');
    setStreamingText('');

    const userMsg = { role: 'user', content: text, msgType: MSG_TYPES.USER, timestamp: Date.now() };
    setChatMessages((prev) => [...prev, userMsg]);

    try {
      const all = [...chatMessagesRef.current, userMsg];
      const { text: respText, readiness: r } = await authoringTurn({
        scope, agent, text, messages: authoringTail(all), total: all.length,
        readinessBefore: readinessRef.current,
        onStream: (partial) => setStreamingText(partial),
      });
      pendingRef.current = { msgs: [reply(agent, respText, readinessRef.current, r)], r };
      setStreamingText(null);
    } catch (e) {
      setError(e.message || 'Failed to send.');
      setStreamingText(null);
      setBusy('');
    }
  }, [agent, scope]);

  return {
    chatMessages, setChatMessages, readiness, setReadiness, busy, setBusy, error, setError,
    streamingText, srAnnouncement, start, handleSend,
  };
}
