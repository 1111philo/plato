import { useState, useEffect, useCallback, useRef } from 'react';
import { adminApi } from './adminApi.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader,
  AlertDialogTitle, AlertDialogDescription, AlertDialogFooter,
  AlertDialogAction, AlertDialogCancel,
} from '@/components/ui/alert-dialog';

import { converseStream, extractCourseMarkdown } from '../../../js/orchestrator.js';
import { parseCoursePrompt } from '../../../js/courseOwner.js';
import { parseResponse, cleanStream } from '../../lib/courseCreationEngine.js';
import { useStreamedText } from '../../hooks/useStreamedText.js';
import { MSG_TYPES } from '../../lib/constants.js';

import ChatArea from '../../components/chat/ChatArea.jsx';
import ComposeBar from '../../components/chat/ComposeBar.jsx';
import AssistantMessage from '../../components/chat/AssistantMessage.jsx';
import UserMessage from '../../components/chat/UserMessage.jsx';
import ThinkingSpinner from '../../components/chat/ThinkingSpinner.jsx';

export default function AdminCourses() {
  const [courses, setCourses] = useState([]);
  const [editing, setEditing] = useState(null); // { courseId, name, markdown, isNew }
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [confirmSave, setConfirmSave] = useState(false);

  useEffect(() => {
    document.title = 'Courses — Admin';
    loadCourses();
  }, []);

  async function loadCourses() {
    setLoading(true);
    try {
      const data = await adminApi('GET', '/v1/admin/courses');
      setCourses(Array.isArray(data) ? data : []);
    } catch { /* ignore */ }
    setLoading(false);
  }

  async function editCourse(courseId) {
    try {
      const data = await adminApi('GET', `/v1/admin/courses/${encodeURIComponent(courseId)}`);
      setEditing({ courseId, name: data.name || courseId, markdown: data.markdown || '', isNew: false });
    } catch (e) { setMessage({ text: e.message, type: 'error' }); }
  }

  async function saveCourse() {
    if (!editing) return;
    const courseId = editing.isNew ? editing.name.trim().replace(/\s+/g, '-').toLowerCase() : editing.courseId;
    try {
      await adminApi('PUT', `/v1/admin/courses/${encodeURIComponent(courseId)}`, {
        markdown: editing.markdown,
        name: editing.name,
      });
      setMessage({ text: 'Course saved.', type: 'success' });
      setEditing(null);
      loadCourses();
    } catch (e) { setMessage({ text: e.message, type: 'error' }); }
  }

  async function deleteCourse(courseId) {
    if (!confirm(`Delete course "${courseId}"?`)) return;
    try {
      await adminApi('DELETE', `/v1/admin/courses/${encodeURIComponent(courseId)}`);
      setMessage({ text: 'Course deleted.', type: 'success' });
      loadCourses();
    } catch (e) { setMessage({ text: e.message, type: 'error' }); }
  }

  if (loading) return <div className="flex items-center justify-center py-12 text-muted-foreground" role="status" aria-live="polite">Loading...</div>;

  // New course creation with AI Chat / Markdown tabs
  if (editing?.isNew) {
    return (
      <NewCourseView
        onSave={async (name, markdown) => {
          const courseId = name.trim().replace(/\s+/g, '-').toLowerCase();
          await adminApi('PUT', `/v1/admin/courses/${encodeURIComponent(courseId)}`, { markdown, name });
          setMessage({ text: 'Course created.', type: 'success' });
          setEditing(null);
          loadCourses();
        }}
        onCancel={() => setEditing(null)}
        onError={(text) => setMessage({ text, type: 'error' })}
      />
    );
  }

  // Edit existing course — markdown only
  if (editing) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-4">Edit: {editing.name}</h1>
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 mb-4 text-sm text-amber-800" role="alert">
          <strong>Caution:</strong> Changes to courses affect all learners immediately. Verify content before saving.
        </div>
        <MarkdownEditor
          name={editing.name}
          markdown={editing.markdown}
          onNameChange={(name) => setEditing({ ...editing, name })}
          onMarkdownChange={(markdown) => setEditing({ ...editing, markdown })}
          onSave={() => setConfirmSave(true)}
          onCancel={() => setEditing(null)}
        />
        <AlertDialog open={confirmSave} onOpenChange={setConfirmSave}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Are you sure?</AlertDialogTitle>
              <AlertDialogDescription>This will update the course for all learners immediately.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => { setConfirmSave(false); saveCourse(); }}>Save Changes</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  // Course list
  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Courses</h1>

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

      <Button className="mb-4" onClick={() => setEditing({ courseId: '', name: '', markdown: '', isNew: true })}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Add Course
      </Button>

      <Card className="p-0 overflow-hidden">
        <Table aria-label="Courses">
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead><span className="sr-only">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {courses.map(c => (
              <TableRow key={c.courseId}>
                <TableCell>{c.name || c.courseId}</TableCell>
                <TableCell>{c.updatedAt ? new Date(c.updatedAt).toLocaleDateString() : '\u2014'}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon-xs" title="Edit" onClick={() => editCourse(c.courseId)} aria-label={`Edit ${c.name}`}>&#9998;</Button>
                    <Button variant="ghost" size="icon-xs" title="Delete" onClick={() => deleteCourse(c.courseId)} aria-label={`Delete ${c.name}`}>&#10005;</Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {courses.length === 0 && (
              <TableRow>
                <TableCell colSpan={3} className="text-center py-6 text-muted-foreground">No courses yet.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

// -- Markdown editor (shared between new + edit) ------------------------------

function MarkdownEditor({ name, markdown, onNameChange, onMarkdownChange, onSave, onCancel }) {
  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="course-name">Course Name</Label>
          <Input
            id="course-name"
            type="text"
            value={name}
            onChange={e => onNameChange(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="course-md">Course Markdown</Label>
          <Textarea
            id="course-md"
            className="font-mono text-sm min-h-[400px]"
            rows={20}
            value={markdown}
            onChange={e => onMarkdownChange(e.target.value)}
            placeholder={"# Course Title\n\nOne-line description.\n\n## Exemplar\n\nWhat the learner will produce...\n\n## Learning Objectives\n\n- Can objective one\n- Can objective two"}
          />
        </div>
        <div className="flex gap-2">
          <Button onClick={onSave}>Save</Button>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
        </div>
      </CardContent>
    </Card>
  );
}

// -- New course view with AI Chat / Markdown tabs -----------------------------

function NewCourseView({ onSave, onCancel, onError }) {
  const [mode, setMode] = useState('chat'); // 'chat' | 'markdown' | 'markdown-only'
  const [chatMessages, setChatMessages] = useState([]);
  const [readiness, setReadiness] = useState(0);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  // Markdown editor state
  const [name, setName] = useState('');
  const [markdown, setMarkdown] = useState('');

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

  // Start conversation on mount
  useEffect(() => {
    let cancelled = false;
    setBusy('starting');
    setStreamingText('');

    (async () => {
      try {
        const raw = await converseStream(
          'course-creator',
          [{ role: 'user', content: 'I want to create a new course.' }],
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

  const handleSend = useCallback(async ({ text }) => {
    if (!text?.trim()) return;
    setError('');
    setBusy('qa');
    setStreamingText('');

    const userMsg = { role: 'user', content: text, msgType: MSG_TYPES.USER, timestamp: Date.now() };
    setChatMessages(prev => [...prev, userMsg]);

    try {
      const tail = [...chatMessages, userMsg].slice(-15).map(m => ({ role: m.role, content: m.content }));

      const raw = await converseStream(
        'course-creator',
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
  }, [chatMessages]);

  async function handleCreateFromChat() {
    setError('');
    setBusy('creating');
    try {
      const conversationText = chatMessages.map(m => `${m.role === 'user' ? 'User' : 'Agent'}: ${m.content}`).join('\n\n');
      const md = await extractCourseMarkdown(conversationText);
      const courseId = `admin-${Date.now()}`;
      const course = parseCoursePrompt(courseId, md);

      if (!course.name || !course.exemplar || !course.learningObjectives.length) {
        setError('Could not build a complete course. Keep refining with the agent, or switch to markdown.');
        setBusy('');
        return;
      }

      await onSave(course.name, md);
    } catch (e) {
      setError(e.message || 'Failed to create course.');
      setBusy('');
    }
  }

  async function handleSwitchToMarkdown() {
    setError('');
    setBusy('extracting');
    try {
      const conversationText = chatMessages.map(m => `${m.role === 'user' ? 'User' : 'Agent'}: ${m.content}`).join('\n\n');
      const md = await extractCourseMarkdown(conversationText);
      const course = parseCoursePrompt('temp', md);
      setName(course.name || '');
      setMarkdown(md);
      setMode('markdown-only');
    } catch (e) {
      setError(e.message || 'Failed to extract course.');
    }
    setBusy('');
  }

  async function handleSaveMarkdown() {
    if (!name.trim()) { setError('Course name is required.'); return; }
    if (!markdown.trim()) { setError('Course markdown is required.'); return; }
    try {
      await onSave(name, markdown);
    } catch (e) {
      onError(e.message);
    }
  }

  const isBusy = !!busy;
  const canCreate = readiness >= 7 && !isBusy;
  const canSwitch = readiness >= 3 && !isBusy;

  const renderMessage = (msg, idx) => {
    if (msg.msgType === MSG_TYPES.USER) return <UserMessage key={idx} content={msg.content} />;
    return <AssistantMessage key={idx} content={msg.content} />;
  };

  // After switching from chat to markdown — show markdown editor only
  if (mode === 'markdown-only') {
    return (
      <div>
        <div className="flex items-center gap-3 mb-4">
          <Button variant="ghost" size="sm" onClick={onCancel} aria-label="Back to courses">&larr; Back</Button>
          <h1 className="text-2xl font-bold">New Course</h1>
        </div>
        {error && <div className="rounded-lg bg-destructive/10 text-destructive px-4 py-3 mb-4 text-sm" role="alert">{error}</div>}
        <MarkdownEditor
          name={name}
          markdown={markdown}
          onNameChange={setName}
          onMarkdownChange={setMarkdown}
          onSave={handleSaveMarkdown}
          onCancel={onCancel}
        />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <Button variant="ghost" size="sm" onClick={onCancel} aria-label="Back to courses">&larr; Back</Button>
        <h1 className="text-2xl font-bold">New Course</h1>
      </div>

      {error && (
        <div className="flex items-center justify-between rounded-lg bg-destructive/10 text-destructive px-4 py-3 mb-4 text-sm" role="alert">
          <span>{error}</span>
          <button onClick={() => setError('')} aria-label="Dismiss error" className="ml-2 text-lg leading-none hover:opacity-70">&times;</button>
        </div>
      )}

      <Tabs defaultValue="chat" value={mode} onValueChange={setMode}>
        <TabsList>
          <TabsTrigger value="chat">AI Chat</TabsTrigger>
          <TabsTrigger value="markdown">Markdown</TabsTrigger>
        </TabsList>

        <TabsContent value="chat" className="mt-4">
          {/* Readiness bar */}
          {chatMessages.length > 0 && (
            <div
              className="mb-4"
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
          )}

          {/* Chat area */}
          <Card className="p-0 overflow-hidden mb-4">
            <div className="max-h-[400px] overflow-y-auto">
              <ChatArea courseName="Course Creator">
                {chatMessages.map(renderMessage)}
                {displayText != null && displayText.length > 0 && (
                  <AssistantMessage content={displayText} />
                )}
                {busy === 'starting' && !displayText && <ThinkingSpinner text="Starting..." />}
                {busy === 'creating' && <ThinkingSpinner text="Generating course..." />}
                {busy === 'extracting' && <ThinkingSpinner text="Extracting course..." />}
                {busy === 'qa' && !displayText && <ThinkingSpinner />}
              </ChatArea>
            </div>
          </Card>

          <ComposeBar
            placeholder="Describe what you want to teach..."
            onSend={handleSend}
            disabled={isBusy}
          />

          {/* Action buttons */}
          {chatMessages.length > 0 && (
            <div className="flex items-center gap-2 mt-4">
              <Button
                onClick={handleCreateFromChat}
                disabled={isBusy}
                size="sm"
              >
                {busy === 'creating' ? 'Creating...' : 'Create Course'}
              </Button>
              {canSwitch && (
                <Button
                  variant="outline"
                  onClick={handleSwitchToMarkdown}
                  disabled={isBusy}
                  size="sm"
                >
                  {busy === 'extracting' ? 'Extracting...' : 'Switch to Markdown'}
                </Button>
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="markdown" className="mt-4">
          <MarkdownEditor
            name={name}
            markdown={markdown}
            onNameChange={setName}
            onMarkdownChange={setMarkdown}
            onSave={handleSaveMarkdown}
            onCancel={onCancel}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
