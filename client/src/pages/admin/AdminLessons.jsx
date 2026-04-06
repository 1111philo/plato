import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { adminApi } from './adminApi.js';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';

import ConfirmModal from '../../components/modals/ConfirmModal.jsx';
import { converseStream, extractLessonMarkdown } from '../../../js/orchestrator.js';
import { parseLessonPrompt } from '../../../js/lessonOwner.js';
import { parseResponse, cleanStream } from '../../lib/lessonCreationEngine.js';
import { useStreamedText } from '../../hooks/useStreamedText.js';
import { MSG_TYPES } from '../../lib/constants.js';

import ChatArea from '../../components/chat/ChatArea.jsx';
import ComposeBar from '../../components/chat/ComposeBar.jsx';
import AssistantMessage from '../../components/chat/AssistantMessage.jsx';
import UserMessage from '../../components/chat/UserMessage.jsx';
import ThinkingSpinner from '../../components/chat/ThinkingSpinner.jsx';

export default function AdminLessons() {
  const navigate = useNavigate();
  const location = useLocation();
  const isNewRoute = location.pathname.endsWith('/new');

  const [lessons, setLessons] = useState([]);
  const [editing, setEditing] = useState(null); // { lessonId, conversation, readiness, needsAgentReply }
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [confirmModal, setConfirmModal] = useState(null);

  useEffect(() => {
    document.title = 'Lessons — Admin';
    loadLessons();
  }, []);

  async function loadLessons() {
    setLoading(true);
    try {
      const data = await adminApi('GET', '/v1/admin/lessons');
      setLessons(Array.isArray(data) ? data : []);
    } catch { /* ignore */ }
    setLoading(false);
  }

  async function editLesson(lessonId) {
    try {
      const data = await adminApi('GET', `/v1/admin/lessons/${encodeURIComponent(lessonId)}`);
      if (data.conversation?.length) {
        // Resume the creation conversation
        setEditing({ lessonId, conversation: data.conversation, readiness: data.readiness ?? 8 });
      } else {
        // No conversation — seed one with the existing markdown so the agent has context
        const seedConversation = [
          { role: 'user', content: `I want to edit an existing lesson. Here is the current lesson markdown:\n\n${data.markdown}\n\nWhat would you like to know about the changes I want to make?`, msgType: MSG_TYPES.USER },
        ];
        setEditing({ lessonId, conversation: seedConversation, readiness: data.readiness ?? 8, needsAgentReply: true });
      }
    } catch (e) { setMessage({ text: e.message, type: 'error' }); }
  }

  function toggleLessonStatus(lessonId, newStatus) {
    const action = newStatus === 'published' ? 'Publish' : 'Unpublish';
    setConfirmModal({
      title: `${action} Lesson?`,
      message: newStatus === 'published'
        ? 'This lesson will become visible to all learners.'
        : 'This lesson will be hidden from learners.',
      confirmLabel: action,
      variant: newStatus === 'published' ? 'success' : 'destructive',
      onConfirm: async () => {
        try {
          await adminApi('PUT', `/v1/admin/lessons/${encodeURIComponent(lessonId)}`, { status: newStatus });
          setMessage({ text: `Lesson ${newStatus === 'published' ? 'published' : 'unpublished'}.`, type: 'success' });
          loadLessons();
        } catch (e) { setMessage({ text: e.message, type: 'error' }); }
      },
    });
  }

  function deleteLesson(lessonId) {
    setConfirmModal({
      title: 'Delete Lesson?',
      message: 'This will permanently delete this lesson. This cannot be undone.',
      confirmLabel: 'Delete Lesson',
      onConfirm: async () => {
        try {
          await adminApi('DELETE', `/v1/admin/lessons/${encodeURIComponent(lessonId)}`);
          setMessage({ text: 'Lesson deleted.', type: 'success' });
          loadLessons();
        } catch (e) { setMessage({ text: e.message, type: 'error' }); }
      },
    });
  }

  if (loading) return <div className="flex items-center justify-center py-12 text-muted-foreground" role="status" aria-live="polite">Loading...</div>;

  // New lesson creation via AI Chat
  if (isNewRoute) {
    return (
      <NewLessonView
        onSave={async (name, markdown, conversation, readiness) => {
          const lessonId = name.trim().replace(/\s+/g, '-').toLowerCase();
          await adminApi('PUT', `/v1/admin/lessons/${encodeURIComponent(lessonId)}`, { markdown, name, status: 'draft', conversation, readiness });
          setMessage({ text: 'Lesson saved as draft.', type: 'success' });
          await loadLessons();
          navigate('/plato/lessons');
        }}
        onCancel={() => navigate('/plato/lessons')}
        onError={(text) => setMessage({ text, type: 'error' })}
      />
    );
  }

  // Edit existing lesson — always via conversation
  if (editing) {
    return (
      <NewLessonView
        editingLessonId={editing.lessonId}
        initialMessages={editing.conversation}
        initialReadiness={editing.readiness}
        needsAgentReply={editing.needsAgentReply}
        onSave={async (name, markdown, conversation, readiness) => {
          await adminApi('PUT', `/v1/admin/lessons/${encodeURIComponent(editing.lessonId)}`, { markdown, name, conversation, readiness });
          setMessage({ text: 'Lesson updated.', type: 'success' });
          setEditing(null);
          loadLessons();
        }}
        onCancel={() => setEditing(null)}
        onError={(text) => setMessage({ text, type: 'error' })}
      />
    );
  }

  // Lesson list
  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Lessons</h1>

      {message && (
        <div
          className={`flex items-center justify-between rounded-lg px-4 py-3 mb-4 text-sm ${
            message.type === 'error'
              ? 'bg-destructive/10 text-destructive'
              : 'bg-green-50 text-green-800'
          }`}
          role="alert"
        >
          <span>{message.text}</span>
          <button onClick={() => setMessage(null)} aria-label="Dismiss" className="ml-2 text-lg leading-none hover:opacity-70">&times;</button>
        </div>
      )}

      <Button className="mb-4" onClick={() => navigate('/plato/lessons/new')}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Add Lesson
      </Button>

      <Card className="p-0 overflow-hidden">
        <Table aria-label="Lessons">
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Created by</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead><span className="sr-only">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lessons.map(c => {
              const isDraft = c.status === 'draft';
              return (
                <TableRow key={c.lessonId}>
                  <TableCell>
                    <span className="flex items-center gap-2">
                      {c.name || c.lessonId}
                      <Badge variant="outline" className={`text-xs ${isDraft ? 'border-amber-300 bg-amber-50 text-amber-800' : ''}`}>{isDraft ? 'Draft' : 'Published'}</Badge>
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{c.createdByName || '\u2014'}</TableCell>
                  <TableCell>{c.updatedAt ? new Date(c.updatedAt).toLocaleDateString() : '\u2014'}</TableCell>
                  <TableCell>
                    <div className="flex gap-1" role="group" aria-label={`Actions for ${c.name}`}>
                      <Button variant="ghost" size="icon-xs" title="Preview" onClick={() => navigate(`/plato/lessons/${encodeURIComponent(c.lessonId)}/preview`)} aria-label={`Preview ${c.name}`}>&#9655;</Button>
                      {isDraft ? (
                        <Button variant="ghost" size="icon-xs" title="Publish — make visible to learners" onClick={() => toggleLessonStatus(c.lessonId, 'published')} aria-label={`Publish ${c.name} — make visible to learners`}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                        </Button>
                      ) : (
                        <Button variant="ghost" size="icon-xs" title="Unpublish — hide from learners" onClick={() => toggleLessonStatus(c.lessonId, 'draft')} aria-label={`Unpublish ${c.name} — hide from learners`}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                        </Button>
                      )}
                      <Button variant="ghost" size="icon-xs" title="Edit" onClick={() => editLesson(c.lessonId)} aria-label={`Edit ${c.name}`}>&#9998;</Button>
                      <Button variant="ghost" size="icon-xs" title="Delete" onClick={() => deleteLesson(c.lessonId)} aria-label={`Delete ${c.name}`}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
            {lessons.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center py-6 text-muted-foreground">No lessons yet.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

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

// -- Lesson creation/editing view with AI Chat --------------------------------

function NewLessonView({ onSave, onCancel, onError, editingLessonId, initialMessages, initialReadiness, needsAgentReply }) {
  const isEditing = !!editingLessonId;
  useEffect(() => { document.title = isEditing ? 'Edit Lesson — Admin' : 'New Lesson — Admin'; }, [isEditing]);
  const [chatMessages, setChatMessages] = useState(initialMessages || []);
  const [readiness, setReadiness] = useState(initialReadiness ?? 0);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [key, setKey] = useState(0); // increment to restart conversation

  // Streaming
  const [streamingText, setStreamingText] = useState(null);
  const displayText = useStreamedText(streamingText);
  const pendingRef = useRef(null);

  // Handle stream drain completing
  useEffect(() => {
    if (displayText === null && pendingRef.current) {
      const { msgs, r } = pendingRef.current;
      pendingRef.current = null;
      if (msgs) setChatMessages(prev => [...prev, ...msgs]);
      if (r != null) setReadiness(r);
      setBusy('');
    }
  }, [displayText]);

  // Start conversation on mount (and on key change after lesson creation)
  // Skip when resuming an existing conversation that already has an agent reply
  const skipInitRef = useRef(!!initialMessages?.length && !needsAgentReply);
  useEffect(() => {
    if (skipInitRef.current) {
      skipInitRef.current = false;
      return;
    }
    let cancelled = false;

    // Determine the opening message(s) to send to the agent
    const openingMessages = (needsAgentReply && initialMessages?.length)
      ? initialMessages.map(m => ({ role: m.role, content: m.content }))
      : [{ role: 'user', content: 'I want to create a new lesson.' }];

    if (!needsAgentReply) {
      setChatMessages([]);
      setReadiness(0);
    }
    setBusy('starting');
    setStreamingText('');
    setError('');

    (async () => {
      try {
        const raw = await converseStream(
          'lesson-creator',
          openingMessages,
          cleanStream((partial) => { if (!cancelled) setStreamingText(partial); }),
          512
        );
        if (cancelled) return;
        const { text, readiness: r } = parseResponse(raw);
        const msg = { role: 'assistant', content: text, msgType: MSG_TYPES.GUIDE, timestamp: Date.now() };
        pendingRef.current = { msgs: [msg], r: r ?? readiness };
        setStreamingText(null);
      } catch (e) {
        if (!cancelled) { setError(e.message || 'Failed to start.'); setBusy(''); setStreamingText(null); }
      }
    })();

    return () => { cancelled = true; };
  }, [key]);

  // Keep a ref to chatMessages so handleSend always has the latest
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
        'lesson-creator',
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

  async function handleCreate() {
    setError('');
    setBusy('creating');
    try {
      const conversationText = chatMessages.map(m => `${m.role === 'user' ? 'User' : 'Agent'}: ${m.content}`).join('\n\n');
      const md = await extractLessonMarkdown(conversationText);
      const lessonId = `admin-${Date.now()}`;
      const lesson = parseLessonPrompt(lessonId, md);

      if (!lesson.name || !lesson.exemplar || !lesson.learningObjectives.length) {
        setError('Could not build a complete lesson. Keep refining with the agent.');
        setBusy('');
        return;
      }

      // Save conversation alongside the markdown so it can be resumed later
      const conversation = chatMessages.map(m => ({ role: m.role, content: m.content, msgType: m.msgType }));
      await onSave(lesson.name, md, conversation, readiness);
      if (!isEditing) setKey(k => k + 1); // Reset for next lesson (new only)
    } catch (e) {
      setError(e.message || 'Failed to create lesson.');
      setBusy('');
    }
  }

  const isBusy = !!busy;

  const renderMessage = (msg, idx) => {
    if (msg.msgType === MSG_TYPES.USER) return <UserMessage key={idx} content={msg.content} />;
    return <AssistantMessage key={idx} content={msg.content} />;
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <Button variant="ghost" size="sm" onClick={onCancel} aria-label="Back to lessons">&larr; Back</Button>
        <h1 className="text-2xl font-bold">{isEditing ? 'Edit Lesson' : 'New Lesson'}</h1>
      </div>

      {error && (
        <div className="flex items-center justify-between rounded-lg bg-destructive/10 text-destructive px-4 py-3 mb-4 text-sm" role="alert">
          <span>{error}</span>
          <button onClick={() => setError('')} aria-label="Dismiss error" className="ml-2 text-lg leading-none hover:opacity-70">&times;</button>
        </div>
      )}

      {/* Readiness bar + Create Lesson button */}
      {(chatMessages.length > 0 || displayText != null) && (
        <div className="flex items-end gap-4 mb-4">
          <div
            className="flex-1"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={10}
            aria-valuenow={readiness}
            aria-label={`Lesson readiness: ${readiness} out of 10`}
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
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              onClick={() => setKey(k => k + 1)}
              disabled={isBusy}
              size="sm"
              aria-label="Start over"
              title="Start over"
            >
              &#8635;
            </Button>
            <Button
              onClick={handleCreate}
              disabled={isBusy}
              size="sm"
            >
              {busy === 'creating' ? (isEditing ? 'Updating...' : 'Creating...') : (isEditing ? 'Update Lesson' : 'Create Lesson')}
            </Button>
          </div>
        </div>
      )}

      {/* Chat + compose in a single container */}
      <div className="rounded-2xl bg-muted/40 border border-border p-4">
        <div className="mb-3">
          <ChatArea lessonName="Lesson Creator">
            {chatMessages.map(renderMessage)}
            {displayText != null && displayText.length > 0 && (
              <AssistantMessage content={displayText} />
            )}
            {busy === 'starting' && !displayText && <ThinkingSpinner text="Starting..." />}
            {busy === 'creating' && <ThinkingSpinner text="Generating lesson..." />}
            {busy === 'qa' && !displayText && <ThinkingSpinner />}
          </ChatArea>
        </div>

        <ComposeBar
          placeholder="Describe what you want to teach..."
          onSend={handleSend}
          disabled={isBusy}
        />
      </div>
    </div>
  );
}
