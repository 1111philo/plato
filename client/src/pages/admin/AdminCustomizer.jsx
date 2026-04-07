import { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { adminApi } from './adminApi.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

import { renderMd } from '../../lib/helpers.js';
import { converseStream, extractKBMarkdown } from '../../../js/orchestrator.js';
import { parseResponse, cleanStream } from '../../lib/lessonCreationEngine.js';
import { useStreamedText } from '../../hooks/useStreamedText.js';
import { MSG_TYPES } from '../../lib/constants.js';

import ChatArea from '../../components/chat/ChatArea.jsx';
import ComposeBar from '../../components/chat/ComposeBar.jsx';
import AssistantMessage from '../../components/chat/AssistantMessage.jsx';
import UserMessage from '../../components/chat/UserMessage.jsx';
import ThinkingSpinner from '../../components/chat/ThinkingSpinner.jsx';

export default function AdminCustomizer() {
  const location = useLocation();
  const navigate = useNavigate();
  const path = location.pathname.replace(/\/+$/, '');
  const isKnowledgeRoute = path.endsWith('/knowledge') || path.endsWith('/knowledge/edit');
  const isEditKBRoute = path.endsWith('/knowledge/edit');
  const tab = isKnowledgeRoute ? 'knowledge' : 'styles';
  const setTab = (t) => navigate(t === 'knowledge' ? '/plato/customizer/knowledge' : '/plato/customizer', { replace: true });
  const [loading, setLoading] = useState(true);

  // Styles state
  const [primary, setPrimary] = useState('#8b1a1a');
  const [accent, setAccent] = useState('#dc2626');
  const [logoBase64, setLogoBase64] = useState(null);
  const [classroomName, setClassroomName] = useState('');
  const [logoError, setLogoError] = useState('');
  const [saving, setSaving] = useState(false);
  const [styleMessage, setStyleMessage] = useState(null);

  // KB state
  const [kbContent, setKbContent] = useState('');
  const [kbConversation, setKbConversation] = useState(null);
  const [kbReadiness, setKbReadiness] = useState(null);
  const [kbUpdatedAt, setKbUpdatedAt] = useState(null);
  const [kbUpdatedByName, setKbUpdatedByName] = useState(null);
  const [kbEditing, setKbEditing] = useState(isEditKBRoute);

  useEffect(() => {
    document.title = 'Classroom Customizer — Admin';
    loadAll();
  }, []);

  async function loadAll() {
    setLoading(true);
    try {
      const [themeData, kbData] = await Promise.all([
        adminApi('GET', '/v1/admin/theme'),
        adminApi('GET', '/v1/admin/knowledge-base'),
      ]);
      const t = themeData.theme || {};
      setPrimary(t.primary || '#8b1a1a');
      setAccent(t.accent || '#dc2626');
      setLogoBase64(themeData.logoBase64 || null);
      setClassroomName(themeData.classroomName || '');
      setKbContent(kbData.content || '');
      setKbConversation(kbData.conversation || null);
      setKbReadiness(kbData.readiness ?? null);
      setKbUpdatedAt(kbData.updatedAt || null);
      setKbUpdatedByName(kbData.updatedByName || null);
    } catch { /* ignore */ }
    setLoading(false);
  }

  async function saveStyle() {
    setSaving(true);
    setStyleMessage(null);
    try {
      await adminApi('PUT', '/v1/admin/theme', { theme: { primary, accent }, logoBase64, classroomName });
      setStyleMessage({ text: 'Saved! Click "Visit Classroom" to see changes.', type: 'success' });
    } catch (e) { setStyleMessage({ text: e.message, type: 'error' }); }
    finally { setSaving(false); }
  }

  function handleLogoUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    setLogoError('');
    if (file.type === 'image/svg+xml') {
      const reader = new FileReader();
      reader.onload = (ev) => setLogoBase64(ev.target.result);
      reader.readAsDataURL(file);
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        if (img.width < 512 || img.height < 512) {
          setLogoError('Image must be at least 512x512px.');
          return;
        }
        const size = 512;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        const scale = Math.min(size / img.width, size / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        setLogoBase64(canvas.toDataURL('image/png'));
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  }

  if (loading) return <div className="flex items-center justify-center py-12 text-muted-foreground" role="status" aria-live="polite">Loading...</div>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Classroom Customizer</h1>

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList aria-label="Customizer sections">
          <TabsTrigger value="styles">Styles</TabsTrigger>
          <TabsTrigger value="knowledge">Knowledge</TabsTrigger>
        </TabsList>

        <TabsContent value="styles">
          <p className="text-sm text-muted-foreground mb-4">Classroom style and branding. These settings only affect the learner-facing classroom.</p>

          <Card className="mb-6">
            <CardHeader><CardTitle>Colors</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">Set two colors — contrast is derived automatically.</p>
              <div className="flex flex-wrap gap-6">
                <div className="flex items-center gap-3">
                  <input type="color" value={primary} onChange={e => setPrimary(e.target.value)}
                    className="w-12 h-12 rounded-lg border border-border cursor-pointer p-0.5" aria-label="Primary color" />
                  <div>
                    <Label>Primary</Label>
                    <p className="text-xs text-muted-foreground">Header, buttons, badges</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <input type="color" value={accent} onChange={e => setAccent(e.target.value)}
                    className="w-12 h-12 rounded-lg border border-border cursor-pointer p-0.5" aria-label="Accent color" />
                  <div>
                    <Label>Accent</Label>
                    <p className="text-xs text-muted-foreground">Links, focus rings</p>
                  </div>
                </div>
              </div>
              <div className="rounded-lg overflow-hidden border border-border" aria-label="Theme preview">
                <div className="px-4 py-2 flex items-center gap-2 text-sm" style={{ backgroundColor: primary, color: lum(primary) < 0.4 ? '#fff' : '#1a1a1a' }}>
                  <span className="font-semibold">Header Preview</span>
                  <span className="ml-auto opacity-80">Nav Item</span>
                </div>
                <div className="px-4 py-3 bg-background text-sm space-y-2">
                  <p>Body text on white background.</p>
                  <a href="#" onClick={e => e.preventDefault()} style={{ color: accent }} className="underline">Accent link</a>
                  <div className="flex gap-2 mt-2">
                    <span className="px-2 py-0.5 rounded text-xs font-medium" style={{ backgroundColor: primary, color: lum(primary) < 0.4 ? '#fff' : '#1a1a1a' }}>Badge</span>
                    <span className="px-2 py-0.5 rounded text-xs font-medium border" style={{ borderColor: accent, color: accent }}>Outline</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="mb-6">
            <CardHeader><CardTitle>Classroom Identity</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="classroom-name">Classroom Name</Label>
                <Input id="classroom-name" type="text" value={classroomName} placeholder="e.g. AI Leaders Academy" onChange={e => setClassroomName(e.target.value)} />
                <p className="text-xs text-muted-foreground">Appears in the header, login pages, and browser tab. Used as the logo text when no image is uploaded.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="logo-file">Logo image (optional)</Label>
                <Input id="logo-file" type="file" accept="image/svg+xml,image/png,image/jpeg,image/webp" onChange={handleLogoUpload} />
                <p className="text-xs text-muted-foreground">Square, at least 512x512px. SVG preferred. If not set, the classroom name is displayed as text.</p>
                {logoError && <p className="text-sm text-destructive">{logoError}</p>}
              </div>
              <div className="p-4 rounded-lg text-center" style={{ backgroundColor: primary, color: lum(primary) < 0.4 ? '#fff' : '#1a1a1a' }}>
                {logoBase64 ? (
                  <img src={logoBase64} alt={classroomName || 'Logo preview'} className="max-h-12 inline-block" />
                ) : (
                  <span className="text-lg font-semibold">{classroomName || 'Your Classroom'}</span>
                )}
              </div>
              {logoBase64 && (
                <Button variant="outline" size="sm" onClick={() => setLogoBase64(null)}>Remove logo image</Button>
              )}
            </CardContent>
          </Card>

          <div className="flex items-center gap-3">
            <Button onClick={saveStyle} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button>
            {styleMessage && <span role="status" aria-live="polite" className={`text-sm ${styleMessage.type === 'error' ? 'text-destructive' : 'text-green-700'}`}>{styleMessage.text}</span>}
          </div>
        </TabsContent>

        <TabsContent value="knowledge">
          {kbEditing ? (
            <KBEditor
              initialContent={kbContent}
              initialConversation={kbConversation}
              initialReadiness={kbReadiness}
              onSave={async (content, conversation, readiness) => {
                await adminApi('PUT', '/v1/admin/knowledge-base', { content, conversation, readiness });
                const fresh = await adminApi('GET', '/v1/admin/knowledge-base');
                setKbContent(content);
                setKbEditing(false);
                setKbUpdatedAt(fresh.updatedAt);
                setKbUpdatedByName(fresh.updatedByName);
                navigate('/plato/customizer/knowledge', { replace: true });
              }}
              onCancel={() => {
                setKbEditing(false);
                navigate('/plato/customizer/knowledge', { replace: true });
              }}
            />
          ) : (
            <KBViewer
              content={kbContent}
              updatedAt={kbUpdatedAt}
              updatedByName={kbUpdatedByName}
              onEdit={() => {
                setKbEditing(true);
                navigate('/plato/customizer/knowledge/edit', { replace: true });
              }}
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// -- KB Viewer (read-only markdown display) -----------------------------------

function KBViewer({ content, updatedAt, updatedByName, onEdit }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-sm text-muted-foreground">
            The knowledge base provides context to the Coach and Lesson Creator agents about your program.
          </p>
          {updatedAt && (
            <p className="text-xs text-muted-foreground mt-1">
              Last updated {new Date(updatedAt).toLocaleDateString()}{updatedByName ? ` by ${updatedByName}` : ''}
            </p>
          )}
        </div>
        <Button onClick={onEdit}>{content ? 'Edit Knowledge Base' : 'Create Knowledge Base'}</Button>
      </div>

      {content ? (
        <Card>
          <CardContent>
            <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: renderMd(content) }} />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <p>No knowledge base yet. Click "Create Knowledge Base" to get started with the AI editor.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// -- KB Editor (conversational AI editor) -------------------------------------

function KBEditor({ initialContent, onSave, onCancel, initialConversation, initialReadiness }) {
  const isEditing = !!initialContent;
  const [chatMessages, setChatMessages] = useState(initialConversation || []);
  const [readiness, setReadiness] = useState(initialReadiness ?? 0);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const [streamingText, setStreamingText] = useState(null);
  const displayText = useStreamedText(streamingText);
  const pendingRef = useRef(null);

  // Auto-save KB conversation after each exchange
  const readinessRef = useRef(readiness);
  useEffect(() => { readinessRef.current = readiness; }, [readiness]);
  useEffect(() => {
    if (chatMessages.length === 0) return;
    const conversation = chatMessages.map(m => ({ role: m.role, content: m.content, msgType: m.msgType }));
    adminApi('PUT', '/v1/admin/knowledge-base/conversation', { conversation, readiness: readinessRef.current }).catch(() => {});
  }, [chatMessages]);

  useEffect(() => {
    if (displayText === null && pendingRef.current) {
      const { msgs, r } = pendingRef.current;
      pendingRef.current = null;
      if (msgs) setChatMessages(prev => [...prev, ...msgs]);
      if (r != null) setReadiness(r);
      setBusy('');
    }
  }, [displayText]);

  // Start conversation — skip if resuming from a saved conversation
  useEffect(() => {
    if (initialConversation?.length) return;
    let cancelled = false;
    setBusy('starting');
    setStreamingText('');

    const openingMessage = isEditing
      ? `I want to edit my existing knowledge base. Here is the current content:\n\n${initialContent}\n\nWhat would you like to know about the changes I want to make?`
      : 'I want to create a knowledge base for my program.';

    if (isEditing) {
      setChatMessages([{ role: 'user', content: openingMessage, msgType: MSG_TYPES.USER, timestamp: Date.now() }]);
    }

    (async () => {
      try {
        const raw = await converseStream(
          'knowledge-base-editor',
          [{ role: 'user', content: openingMessage }],
          cleanStream((partial) => { if (!cancelled) setStreamingText(partial); }),
          512
        );
        if (cancelled) return;
        const { text, readiness: r } = parseResponse(raw);
        const msg = { role: 'assistant', content: text, msgType: MSG_TYPES.GUIDE, timestamp: Date.now() };
        pendingRef.current = { msgs: [msg], r: r ?? (isEditing ? 8 : 1) };
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
      const md = await extractKBMarkdown(conversationText, initialContent);
      if (!md || md.length < 50) {
        setError('Could not generate a knowledge base from the conversation. Keep adding information.');
        setBusy('');
        return;
      }
      const conversation = chatMessages.map(m => ({ role: m.role, content: m.content, msgType: m.msgType }));
      await onSave(md, conversation, readiness);
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
    <div>
      <div className="flex items-center gap-3 mb-4">
        <Button variant="ghost" size="sm" onClick={onCancel} aria-label="Back to knowledge base">&larr; Back</Button>
        <h2 className="text-lg font-semibold">{isEditing ? 'Edit Knowledge Base' : 'Create Knowledge Base'}</h2>
      </div>

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
          <Button
            onClick={handleSaveKB}
            disabled={isBusy || readiness < 3}
            size="sm"
            title={readiness < 3 ? 'Tell the editor about your classroom goal, learners, and teachers first' : undefined}
          >
            {busy === 'creating' ? 'Saving...' : (isEditing ? 'Update Knowledge Base' : 'Save Knowledge Base')}
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
    </div>
  );
}

function lum(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const lin = (c) => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
