import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { adminApi } from './adminApi.js';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';

import ConfirmModal from '../../components/modals/ConfirmModal.jsx';
import ShareLessonModal from '../../components/modals/ShareLessonModal.jsx';
import { converseStream, extractLessonMarkdown } from '../../../js/orchestrator.js';
import { parseLessonPrompt } from '../../../js/lessonOwner.js';
import { parseResponse, cleanStream } from '../../lib/lessonCreationEngine.js';
import { useStreamedText } from '../../hooks/useStreamedText.js';
import { useTitleNotification } from '../../hooks/useTitleNotification.js';
import { MSG_TYPES } from '../../lib/constants.js';

import ChatArea from '../../components/chat/ChatArea.jsx';
import ComposeBar from '../../components/chat/ComposeBar.jsx';
import AssistantMessage from '../../components/chat/AssistantMessage.jsx';
import UserMessage from '../../components/chat/UserMessage.jsx';
import ThinkingSpinner from '../../components/chat/ThinkingSpinner.jsx';

export default function AdminLessons() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const isNewRoute = location.pathname.endsWith('/new');

  const [lessons, setLessons] = useState([]);
  const [editing, setEditing] = useState(null); // { lessonId, conversation, readiness, needsAgentReply, isDraft }
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [confirmModal, setConfirmModal] = useState(null);
  // Stable lesson ID for a fresh /new session; regenerated each time the /new route is entered.
  const [newDraftId, setNewDraftId] = useState(() => `admin-${Date.now()}`);
  useEffect(() => {
    if (isNewRoute) setNewDraftId(`admin-${Date.now()}`);
  }, [isNewRoute]);

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
      // A record is a live draft iff status==='draft' and markdown is empty.
      // Legacy records with status='draft' but stored markdown are treated as private.
      const isDraft = data.status === 'draft' && !data.markdown;
      if (data.conversation?.length) {
        // Resume the creation conversation (drafts always land here)
        setEditing({ lessonId, conversation: data.conversation, readiness: data.readiness ?? (isDraft ? 1 : 8), isDraft });
      } else {
        // No conversation — seed one with the existing markdown so the agent has context
        const seedConversation = [
          { role: 'user', content: `I want to edit an existing lesson. Here is the current lesson markdown:\n\n${data.markdown}\n\nWhat would you like to know about the changes I want to make?`, msgType: MSG_TYPES.USER },
        ];
        setEditing({ lessonId, conversation: seedConversation, readiness: data.readiness ?? 8, needsAgentReply: true, isDraft });
      }
    } catch (e) { setMessage({ text: e.message, type: 'error' }); }
  }

  const [shareModal, setShareModal] = useState(null); // { lessonId, lessonName, sharedWith, status }

  function openShareModal(lessonId, lessonName, currentSharedWith, status) {
    setShareModal({ lessonId, lessonName, sharedWith: currentSharedWith || [], status: status || 'private' });
  }

  async function handleShareConfirm({ status, sharedWith }) {
    if (!shareModal) return;
    try {
      await adminApi('PUT', `/v1/admin/lessons/${encodeURIComponent(shareModal.lessonId)}`, { status, sharedWith });
      const msg = status === 'public'
        ? 'Lesson is now public.'
        : `Lesson shared with ${sharedWith.length} ${sharedWith.length === 1 ? 'user' : 'users'}.`;
      setMessage({ text: msg, type: 'success' });
      setShareModal(null);
      loadLessons();
    } catch (e) { setMessage({ text: e.message, type: 'error' }); }
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

  // New lesson creation via AI Chat. Each /new mount gets a fresh draft lesson ID
  // so multiple drafts can exist in parallel (issue #101).
  if (isNewRoute) {
    return (
      <NewLessonView
        lessonId={newDraftId}
        isDraft
        onSave={async (name, markdown, conversation, readiness) => {
          await adminApi('PUT', `/v1/admin/lessons/${encodeURIComponent(newDraftId)}`, {
            markdown, name, status: 'private', sharedWith: [user.userId], conversation, readiness,
          });
          setMessage({ text: 'Lesson created (private).', type: 'success' });
          await loadLessons();
          navigate('/plato/lessons');
        }}
        onCancel={() => navigate('/plato/lessons')}
        onError={(text) => setMessage({ text, type: 'error' })}
      />
    );
  }

  // Edit existing lesson — always via conversation. When the record is a draft,
  // finalizing extracts markdown and flips status draft → private on the same record.
  if (editing) {
    return (
      <NewLessonView
        lessonId={editing.lessonId}
        isDraft={editing.isDraft}
        initialMessages={editing.conversation}
        initialReadiness={editing.readiness}
        needsAgentReply={editing.needsAgentReply}
        onSave={async (name, markdown, conversation, readiness) => {
          const body = { markdown, name, conversation, readiness };
          if (editing.isDraft) {
            body.status = 'private';
            body.sharedWith = [user.userId];
          }
          await adminApi('PUT', `/v1/admin/lessons/${encodeURIComponent(editing.lessonId)}`, body);
          setMessage({ text: editing.isDraft ? 'Lesson created (private).' : 'Lesson updated.', type: 'success' });
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
              <TableHead>Updated by</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead><span className="sr-only">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lessons.map(c => {
              const isDraft = c.status === 'draft';
              const isPublic = c.status === 'public';
              return (
                <TableRow key={c.lessonId}>
                  <TableCell>
                    <span className="flex items-center gap-2">
                      {c.name || c.lessonId}
                      {isDraft
                        ? <Badge variant="outline" className="text-xs border-amber-300 bg-amber-50 text-amber-800">Draft</Badge>
                        : isPublic
                          ? <Badge variant="outline" className="text-xs">Public</Badge>
                          : <Badge variant="outline" className="text-xs border-violet-300 bg-violet-50 text-violet-800">Private{c.sharedWith?.length ? ` (${c.sharedWith.length})` : ''}</Badge>
                      }
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{c.updatedByName || '\u2014'}</TableCell>
                  <TableCell>{c.updatedAt ? new Date(c.updatedAt).toLocaleDateString() : '\u2014'}</TableCell>
                  <TableCell>
                    <div className="flex gap-1" role="group" aria-label={`Actions for ${c.name}`}>
                      {!isDraft && (
                        <Button variant="ghost" size="icon-xs" title="Visibility &amp; sharing" onClick={() => openShareModal(c.lessonId, c.name, c.sharedWith, c.status)} aria-label={`Visibility and sharing for ${c.name}`}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>
                        </Button>
                      )}
                      <Button variant="ghost" size="icon-xs" title={isDraft ? 'Resume draft' : 'Edit'} onClick={() => editLesson(c.lessonId)} aria-label={isDraft ? `Resume draft ${c.name}` : `Edit ${c.name}`}>&#9998;</Button>
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

      {shareModal && (
        <ShareLessonModal
          open={!!shareModal}
          onOpenChange={(open) => { if (!open) setShareModal(null); }}
          lessonName={shareModal.lessonName}
          initialSharedWith={shareModal.sharedWith}
          initialStatus={shareModal.status}
          onConfirm={handleShareConfirm}
        />
      )}
    </div>
  );
}

// -- Lesson creation/editing view with AI Chat --------------------------------

function NewLessonView({ onSave, onCancel, onError, lessonId, isDraft, initialMessages, initialReadiness, needsAgentReply }) {
  // A view is in "create" mode when it's driving a fresh or in-progress draft.
  // It's in "edit" mode when finalizing a non-draft lesson's content.
  const isCreate = !!isDraft;
  const pageTitle = isCreate ? 'New Lesson — Admin' : 'Edit Lesson — Admin';
  useEffect(() => { document.title = pageTitle; }, [pageTitle]);
  const notifyTitle = useTitleNotification(pageTitle);
  const [chatMessages, setChatMessages] = useState(initialMessages || []);
  const [readiness, setReadiness] = useState(initialReadiness ?? 0);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [key, setKey] = useState(0); // increment to restart conversation

  // Streaming
  const [streamingText, setStreamingText] = useState(null);
  const displayText = useStreamedText(streamingText);
  const pendingRef = useRef(null);
  const [srAnnouncement, setSrAnnouncement] = useState('');

  // Auto-save conversation after each exchange. Drafts use the main PUT with
  // status=draft so the first save creates the record; non-drafts use the
  // lighter /conversation endpoint that never touches markdown or status.
  const readinessRef = useRef(readiness);
  useEffect(() => { readinessRef.current = readiness; }, [readiness]);
  useEffect(() => {
    if (chatMessages.length === 0) return;
    const conversation = chatMessages.map(m => ({ role: m.role, content: m.content, msgType: m.msgType }));
    const r = readinessRef.current;
    if (isCreate) {
      adminApi('PUT', `/v1/admin/lessons/${encodeURIComponent(lessonId)}`, {
        status: 'draft',
        name: 'Untitled draft',
        conversation,
        readiness: r,
      }).catch(() => {});
    } else {
      adminApi('PUT', `/v1/admin/lessons/${encodeURIComponent(lessonId)}/conversation`, { conversation, readiness: r }).catch(() => {});
    }
  }, [chatMessages, isCreate, lessonId]);

  // Handle stream drain completing
  useEffect(() => {
    if (displayText === null && pendingRef.current) {
      const { msgs, r } = pendingRef.current;
      pendingRef.current = null;
      if (msgs) {
        setChatMessages(prev => [...prev, ...msgs]);
        if (msgs.some(m => m.role === 'assistant')) {
          setSrAnnouncement('');
          requestAnimationFrame(() => setSrAnnouncement('New message received'));
          notifyTitle();
        }
      }
      if (r != null) setReadiness(r);
      setBusy('');
    }
  }, [displayText, notifyTitle]);

  // Start conversation on mount (and on key change after lesson creation).
  // Skip when resuming an existing conversation that already has an agent reply.
  const skipInitRef = useRef(!!initialMessages?.length && !needsAgentReply);
  useEffect(() => {
    if (skipInitRef.current) {
      skipInitRef.current = false;
      return;
    }
    if (chatMessages.length > 0 && key === 0) return;
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
      const lesson = parseLessonPrompt(lessonId, md);

      if (!lesson.name || !lesson.exemplar || !lesson.learningObjectives.length) {
        setError('Could not build a complete lesson. Keep refining with the agent.');
        setBusy('');
        return;
      }

      // Save conversation alongside the markdown so it can be resumed later
      const conversation = chatMessages.map(m => ({ role: m.role, content: m.content, msgType: m.msgType }));
      await onSave(lesson.name, md, conversation, readiness);
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
        <h1 className="text-2xl font-bold">{isCreate ? 'New Lesson' : 'Edit Lesson'}</h1>
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
              {busy === 'creating' ? (isCreate ? 'Creating...' : 'Updating...') : (isCreate ? 'Create Lesson' : 'Update Lesson')}
            </Button>
          </div>
        </div>
      )}

      {/* Chat + compose in a single container */}
      <div className="rounded-2xl bg-muted/40 border border-border p-4">
        <div className="mb-3">
          <ChatArea announcement={srAnnouncement}>
            {chatMessages.map(renderMessage)}
            {displayText != null && displayText.length > 0 && (
              <AssistantMessage content={displayText} streaming />
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
