import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { adminApi } from './adminApi.js';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';

import ConfirmModal from '../../components/modals/ConfirmModal.jsx';
import ShareLessonModal from '../../components/modals/ShareLessonModal.jsx';
import CoursesModal from './CoursesModal.jsx';
import LessonPreviewPane from './LessonPreviewPane.jsx';
import { converseStream, extractLessonMarkdown } from '../../../js/orchestrator.js';
import { parseLessonPrompt } from '../../../js/lessonOwner.js';
import { parseResponse, cleanStream, buildConversationText } from '../../lib/lessonCreationEngine.js';
import { useStreamedText } from '../../hooks/useStreamedText.js';
import { useTitleNotification } from '../../hooks/useTitleNotification.js';
import { MSG_TYPES } from '../../lib/constants.js';

import ChatArea from '../../components/chat/ChatArea.jsx';
import ComposeBar from '../../components/chat/ComposeBar.jsx';
import AssistantMessage from '../../components/chat/AssistantMessage.jsx';
import UserMessage from '../../components/chat/UserMessage.jsx';
import ThinkingSpinner from '../../components/chat/ThinkingSpinner.jsx';

// A draft id minted by /plato/lessons/new looks like `admin-<13-digit ms>`.
// Within a few minutes of minting, a 404 means "not auto-saved yet" rather
// than "bad id" — so the editor opens in create mode instead of bouncing to
// the list.
const FRESH_DRAFT_WINDOW_MS = 5 * 60 * 1000;
function isFreshlyMintedDraftId(id) {
  const m = /^admin-(\d{13})$/.exec(id || '');
  return !!m && Date.now() - Number(m[1]) < FRESH_DRAFT_WINDOW_MS;
}

export default function AdminLessons() {
  const navigate = useNavigate();
  const location = useLocation();
  const { lessonId: routeLessonId } = useParams();
  const { user } = useAuth();
  const isNewRoute = location.pathname.endsWith('/lessons/new');

  const [lessons, setLessons] = useState([]);
  const [courses, setCourses] = useState([]);
  const [coursesOpen, setCoursesOpen] = useState(false);
  // Editor data for the lesson open at /plato/lessons/:lessonId/edit.
  const [editing, setEditing] = useState(null); // { lessonId, conversation, readiness, needsAgentReply, isDraft, initialCourse, markdown }
  const [editorLoading, setEditorLoading] = useState(false);
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [confirmModal, setConfirmModal] = useState(null);

  // /plato/lessons/new mints a fresh draft id and redirects to its stable
  // edit URL, so the editor survives reload and browser-back (it previously
  // had no route — a reload dropped the admin back to the list). The draft
  // record is created lazily by the editor's first auto-save.
  const newDraftIdRef = useRef(null);
  if (isNewRoute) {
    if (!newDraftIdRef.current) newDraftIdRef.current = `admin-${Date.now()}`;
  } else {
    newDraftIdRef.current = null;
  }
  useEffect(() => {
    if (isNewRoute && newDraftIdRef.current) {
      navigate(`/plato/lessons/${encodeURIComponent(newDraftIdRef.current)}/edit`, { replace: true });
    }
  }, [isNewRoute, navigate]);

  // Map courseId -> name for rendering tags on lesson rows.
  const courseNamesById = new Map(courses.map((c) => [c.courseId, c.name]));

  useEffect(() => {
    document.title = 'Lessons — Admin';
    loadLessons();
    loadCourses();
  }, []);

  async function loadCourses() {
    try {
      const data = await adminApi('GET', '/v1/admin/courses');
      setCourses(Array.isArray(data) ? data : []);
    } catch { /* non-blocking — list still renders */ }
  }

  async function loadLessons() {
    setLoading(true);
    try {
      const data = await adminApi('GET', '/v1/admin/lessons');
      setLessons(Array.isArray(data) ? data : []);
    } catch { /* ignore */ }
    setLoading(false);
  }

  // Open the editor for a lesson by navigating to its deep-linkable route.
  function openLessonEditor(lessonId) {
    navigate(`/plato/lessons/${encodeURIComponent(lessonId)}/edit`);
  }

  // Load the lesson for the :lessonId edit route. A just-minted draft has no
  // server record until the editor's first auto-save, so a 404 on a freshly
  // minted draft id opens create mode; any other failure bounces to the list
  // (mirrors the users/:userId deep-link pattern).
  useEffect(() => {
    if (!routeLessonId) { setEditing(null); return; }
    let cancelled = false;
    setEditorLoading(true);
    (async () => {
      try {
        const data = await adminApi('GET', `/v1/admin/lessons/${encodeURIComponent(routeLessonId)}`);
        if (cancelled) return;
        // A record is a live draft iff status==='draft' and markdown is empty.
        // Legacy records with status='draft' but stored markdown are private.
        const isDraft = data.status === 'draft' && !data.markdown;
        const initialCourse = data.course || null;
        const markdown = data.markdown || '';
        if (data.conversation?.length) {
          // Resume the in-progress creation/edit conversation.
          setEditing({ lessonId: routeLessonId, conversation: data.conversation, readiness: data.readiness ?? (isDraft ? 1 : 8), isDraft, initialCourse, markdown });
        } else if (isDraft) {
          // Empty draft — open the editor in create mode.
          setEditing({ lessonId: routeLessonId, conversation: null, readiness: 0, isDraft: true, initialCourse, markdown: '' });
        } else {
          // Finalized lesson with no stored conversation — seed one with the
          // existing markdown so the agent has context to edit from.
          const seedConversation = [
            { role: 'user', content: `I want to edit an existing lesson. Here is the current lesson markdown:\n\n${data.markdown}\n\nWhat would you like to know about the changes I want to make?`, msgType: MSG_TYPES.USER },
          ];
          setEditing({ lessonId: routeLessonId, conversation: seedConversation, readiness: data.readiness ?? 8, needsAgentReply: true, isDraft: false, initialCourse, markdown });
        }
      } catch {
        if (cancelled) return;
        if (isFreshlyMintedDraftId(routeLessonId)) {
          // Brand-new draft that hasn't auto-saved yet — open create mode.
          setEditing({ lessonId: routeLessonId, conversation: null, readiness: 0, isDraft: true, initialCourse: null, markdown: '' });
        } else {
          setMessage({ text: 'That lesson could not be opened.', type: 'error' });
          navigate('/plato/lessons', { replace: true });
        }
      } finally {
        if (!cancelled) setEditorLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [routeLessonId, navigate]);

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

  const spinner = (
    <div className="flex items-center justify-center py-12 text-muted-foreground" role="status" aria-live="polite">Loading...</div>
  );

  // Redirecting /plato/lessons/new → the freshly minted draft's edit URL.
  if (isNewRoute) return spinner;

  // Lesson editor — create a draft, resume a draft, or edit a finalized
  // lesson. Deep-linked at /plato/lessons/:lessonId/edit so it survives
  // reload and browser-back. When the record is a draft, finalizing extracts
  // markdown and flips status draft → private on the same record.
  if (routeLessonId) {
    if (editorLoading || !editing) return spinner;
    return (
      <NewLessonView
        key={editing.lessonId}
        lessonId={editing.lessonId}
        isDraft={editing.isDraft}
        initialMessages={editing.conversation}
        initialReadiness={editing.readiness}
        needsAgentReply={editing.needsAgentReply}
        initialCourse={editing.initialCourse}
        initialMarkdown={editing.markdown}
        onSave={async (name, markdown, conversation, readiness) => {
          // null name + markdown = the editor decided there was nothing new
          // to extract (e.g. admin only changed the course dropdown). Skip
          // the lesson PUT — those metadata changes auto-saved on edit —
          // but still show the toast and refresh the list so the admin
          // gets visible confirmation.
          if (name && markdown) {
            const body = { markdown, name, conversation, readiness };
            if (editing.isDraft) {
              body.status = 'private';
              body.sharedWith = [user.userId];
            }
            await adminApi('PUT', `/v1/admin/lessons/${encodeURIComponent(editing.lessonId)}`, body);
          }
          setMessage({ text: editing.isDraft ? 'Lesson created (private).' : 'Lesson updated.', type: 'success' });
          await loadLessons();
          navigate('/plato/lessons');
        }}
        onCancel={async () => { await loadLessons(); navigate('/plato/lessons'); }}
        onError={(text) => setMessage({ text, type: 'error' })}
      />
    );
  }

  // Lesson list
  if (loading) return spinner;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Lessons</h1>
        <div className="flex gap-2">
          <Button onClick={() => navigate('/plato/lessons/new')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add Lesson
          </Button>
          <Button variant="outline" onClick={() => setCoursesOpen(true)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
            Courses
          </Button>
        </div>
      </div>

      {/* Always-mounted live region — guarantees screen readers announce the
          success/error message even when the editor unmounts in the same
          render as the message is set (a conditionally-rendered role="alert"
          is sometimes missed because it's present on the list's first render
          rather than appearing dynamically). The visible alert below stays
          for sighted users; this sr-only region drives the announcement. */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {message?.text || ''}
      </div>

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

      <Card className="p-0 overflow-hidden">
        <Table aria-label="Lessons">
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Course</TableHead>
              <TableHead>Created by</TableHead>
              <TableHead>Updated by</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead><span className="sr-only">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lessons.map(c => {
              const isDraft = c.status === 'draft';
              const isPublic = c.status === 'public';
              const courseName = c.course ? (courseNamesById.get(c.course) || null) : null;
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
                  <TableCell className="text-muted-foreground">{courseName || '\u2014'}</TableCell>
                  <TableCell className="text-muted-foreground">{c.createdByName || '\u2014'}</TableCell>
                  <TableCell className="text-muted-foreground">{c.updatedByName || '\u2014'}</TableCell>
                  <TableCell>{c.updatedAt ? new Date(c.updatedAt).toLocaleDateString() : '\u2014'}</TableCell>
                  <TableCell>
                    <div className="flex gap-1" role="group" aria-label={`Actions for ${c.name}`}>
                      {!isDraft && (
                        <Button variant="ghost" size="icon-xs" title="Visibility &amp; sharing" onClick={() => openShareModal(c.lessonId, c.name, c.sharedWith, c.status)} aria-label={`Visibility and sharing for ${c.name}`}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>
                        </Button>
                      )}
                      <Button variant="ghost" size="icon-xs" title={isDraft ? 'Resume draft' : 'Edit'} onClick={() => openLessonEditor(c.lessonId)} aria-label={isDraft ? `Resume draft ${c.name}` : `Edit ${c.name}`}>&#9998;</Button>
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
                <TableCell colSpan={6} className="text-center py-6 text-muted-foreground">No lessons yet.</TableCell>
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

      <CoursesModal
        open={coursesOpen}
        onOpenChange={setCoursesOpen}
        onMutated={() => { loadCourses(); loadLessons(); }}
      />

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

function NewLessonView({ onSave, onCancel, onError: _onError, lessonId, isDraft, initialMessages, initialReadiness, needsAgentReply, initialCourse, initialMarkdown }) {
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
  const [courses, setCourses] = useState([]);
  const [course, setCourse] = useState(initialCourse || '');

  // Markdown preview pane. Refreshed manually via the lesson-extractor agent;
  // never persisted until the admin clicks Create/Update Lesson.
  const [previewMarkdown, setPreviewMarkdown] = useState(initialMarkdown || '');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  // Number of chat messages the current preview reflects. In edit mode the
  // saved markdown was extracted from the resumed conversation, so it starts
  // in sync; a fresh draft has no markdown yet.
  const [previewSyncedAt, setPreviewSyncedAt] = useState(
    initialMarkdown ? (initialMessages?.length || 0) : 0
  );

  // Load course list once on mount so the dropdown can populate.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await adminApi('GET', '/v1/admin/courses');
        if (!cancelled && Array.isArray(data)) setCourses(data);
      } catch { /* dropdown stays empty; admin can still create the lesson */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // Streaming
  const [streamingText, setStreamingText] = useState(null);
  const displayText = useStreamedText(streamingText);
  const pendingRef = useRef(null);
  const [srAnnouncement, setSrAnnouncement] = useState('');

  // Auto-save conversation after each exchange. Drafts use the main PUT with
  // status=draft so the first save creates the record; non-drafts use the
  // lighter /conversation endpoint that never touches markdown or status.
  // Drafts also fold the current course assignment into the same payload so
  // a course chosen before the first save is persisted along with the record.
  const readinessRef = useRef(readiness);
  useEffect(() => { readinessRef.current = readiness; }, [readiness]);
  const courseRef = useRef(course);
  useEffect(() => { courseRef.current = course; }, [course]);
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
        course: courseRef.current || null,
      }).catch(() => {});
    } else {
      adminApi('PUT', `/v1/admin/lessons/${encodeURIComponent(lessonId)}/conversation`, { conversation, readiness: r }).catch(() => {});
    }
  }, [chatMessages, isCreate, lessonId]);

  // Persist the course immediately on change. Works for finalized lessons too
  // (the lesson PUT preserves all other fields when only `course` is sent).
  // For brand-new drafts that don't yet have a server record, the auto-save
  // effect above will pick up courseRef on its first tick.
  async function changeCourse(nextCourseId) {
    setCourse(nextCourseId);
    try {
      const body = { course: nextCourseId || null };
      // Drafts must keep status=draft and name on PUTs; preserve them.
      if (isCreate) {
        body.status = 'draft';
        body.name = 'Untitled draft';
      }
      await adminApi('PUT', `/v1/admin/lessons/${encodeURIComponent(lessonId)}`, body);
    } catch (e) {
      setError(e.message || 'Failed to update course.');
    }
  }

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
    // When editing an existing finalized lesson, an admin may open the editor
    // just to change a metadata field (e.g. the course assignment) without
    // chatting with the agent. Those changes auto-save on edit, so there's
    // nothing for the lesson-extractor to do and the conversation hasn't
    // grown beyond the seed prompt + the agent's first reply. Skip the
    // re-extraction (which would fail with "Could not build a complete
    // lesson") and call onSave with null markdown — the parent skips the
    // lesson PUT but still shows the success toast and refreshes the list,
    // so the admin gets visible confirmation that their metadata change
    // landed.
    const userMsgCount = chatMessages.filter(m => m.role === 'user').length;
    if (!isCreate && userMsgCount <= 1) {
      setBusy('creating');
      try {
        await onSave(null, null, null, null);
      } catch (e) {
        setError(e.message || 'Failed to update lesson.');
        setBusy('');
      }
      return;
    }
    setBusy('creating');
    try {
      const md = await extractLessonMarkdown(buildConversationText(chatMessages));
      const lesson = parseLessonPrompt(lessonId, md);

      if (!lesson.name || !lesson.exemplar || !lesson.learningObjectives.length) {
        setError('Could not build a complete lesson. Keep refining with the agent.');
        setBusy('');
        return;
      }

      // Keep the preview in sync with what we're about to save.
      setPreviewMarkdown(md);
      setPreviewSyncedAt(chatMessages.length);

      // Save conversation alongside the markdown so it can be resumed later
      const conversation = chatMessages.map(m => ({ role: m.role, content: m.content, msgType: m.msgType }));
      await onSave(lesson.name, md, conversation, readiness);
    } catch (e) {
      setError(e.message || 'Failed to create lesson.');
      setBusy('');
    }
  }

  const isBusy = !!busy;
  const previewStale = !!previewMarkdown && chatMessages.length > previewSyncedAt;

  // Refresh the markdown preview by re-running the lesson-extractor agent.
  // Runs independently of the chat — never sets `busy`.
  async function handleRefreshPreview() {
    if (chatMessages.length === 0) {
      setPreviewError('Start the conversation first, then refresh.');
      return;
    }
    setPreviewError('');
    setPreviewLoading(true);
    try {
      const md = await extractLessonMarkdown(buildConversationText(chatMessages));
      setPreviewMarkdown(md);
      setPreviewSyncedAt(chatMessages.length);
    } catch (e) {
      setPreviewError(e.message || 'Failed to generate preview.');
    } finally {
      setPreviewLoading(false);
    }
  }

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

      {/* Lesson metadata — course assignment.
          Visible during creation and editing; admins can re-assign at any time. */}
      <div className="flex items-center gap-3 mb-4">
        <label htmlFor="lesson-course" className="text-sm text-muted-foreground">Course</label>
        <select
          id="lesson-course"
          value={course}
          onChange={(e) => changeCourse(e.target.value)}
          className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <option value="">No course</option>
          {courses.map((c) => (
            <option key={c.courseId} value={c.courseId}>{c.name}</option>
          ))}
        </select>
      </div>

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

      {/* Chat (left) + markdown preview (right). Stacks vertically below `lg`. */}
      <div className="flex flex-col lg:flex-row gap-4">
        <div className="lg:w-3/5 min-w-0">
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

        <div className="lg:w-2/5 min-w-0">
          <LessonPreviewPane
            markdown={previewMarkdown}
            loading={previewLoading}
            error={previewError}
            stale={previewStale}
            isCreate={isCreate}
            refreshDisabled={previewLoading || isBusy}
            onRefresh={handleRefreshPreview}
          />
        </div>
      </div>
    </div>
  );
}
