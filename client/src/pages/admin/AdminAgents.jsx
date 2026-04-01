import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { adminApi } from './adminApi.js';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader,
  AlertDialogTitle, AlertDialogDescription, AlertDialogFooter,
  AlertDialogAction, AlertDialogCancel,
} from '@/components/ui/alert-dialog';

const AGENTS = [
  {
    id: 'coach',
    name: 'Coach',
    description: 'The learner\'s companion in a continuous conversation. Coaches toward the exemplar, creates activities inline, evaluates submissions (text and images), and tracks progress.',
    receives: ['Course KB', 'Learner profile', 'Conversation history', 'Knowledge base'],
    outputs: ['Coaching responses', 'Inline activities', 'Progress [PROGRESS: 0-10]', 'KB updates [KB_UPDATE]', 'Profile updates [PROFILE_UPDATE]'],
    usesKB: true,
  },
  {
    id: 'course-creator',
    name: 'Course Creator',
    description: 'Guides users through designing custom courses via conversational chat. Helps define an exemplar and learning objectives.',
    receives: ['Conversation history', 'Knowledge base'],
    outputs: ['Coaching responses', 'Readiness signal [READINESS: 0-10]'],
    usesKB: true,
  },
  {
    id: 'course-owner',
    name: 'Course Owner',
    description: 'Initializes a course knowledge base from the course prompt. Produces structured objectives with evidence descriptors.',
    receives: ['Course prompt (exemplar + objectives)', 'Learner profile summary'],
    outputs: ['Structured course KB (JSON)'],
  },
  {
    id: 'course-extractor',
    name: 'Course Extractor',
    description: 'Extracts structured course markdown from a course creation conversation.',
    receives: ['Course creation conversation text'],
    outputs: ['Course markdown (title, exemplar, objectives)'],
  },
  {
    id: 'learner-profile-owner',
    name: 'Learner Profile Owner',
    description: 'Deep profile update when a learner completes a course. Revises the full profile based on demonstrated mastery.',
    receives: ['Current profile', 'Course KB', 'Course name', 'Activities completed'],
    outputs: ['Updated learner profile (JSON)'],
  },
  {
    id: 'learner-profile-update',
    name: 'Learner Profile Update',
    description: 'Incremental profile update from direct learner feedback or observations.',
    receives: ['Current profile', 'Feedback text', 'Activity context'],
    outputs: ['Updated profile fields (JSON)'],
  },
];

export default function AdminAgents() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') || 'knowledge';
  const setTab = (t) => setSearchParams({ tab: t }, { replace: true });
  const [prompts, setPrompts] = useState({});
  const [knowledgeBase, setKnowledgeBase] = useState('');
  const [kbDraft, setKbDraft] = useState('');
  const [kbEditing, setKbEditing] = useState(false);
  const [editing, setEditing] = useState(null);
  const [editContent, setEditContent] = useState('');
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null); // { type: 'kb' | 'prompt' }

  useEffect(() => {
    document.title = 'Agents & Knowledge — plato';
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const [promptList, kb] = await Promise.all([
        adminApi('GET', '/v1/admin/prompts'),
        adminApi('GET', '/v1/admin/knowledge-base'),
      ]);
      const map = {};
      for (const p of (Array.isArray(promptList) ? promptList : [])) map[p.name] = p;
      setPrompts(map);
      setKnowledgeBase(kb.content || '');
      setKbDraft(kb.content || '');
    } catch { /* ignore */ }
    setLoading(false);
  }

  async function saveKB() {
    setSaving(true);
    setMessage(null);
    try {
      await adminApi('PUT', '/v1/admin/knowledge-base', { content: kbDraft });
      setKnowledgeBase(kbDraft);
      setKbEditing(false);
      setMessage({ text: 'Knowledge base saved.', type: 'success' });
    } catch (e) { setMessage({ text: e.message, type: 'error' }); }
    finally { setSaving(false); }
  }

  async function startEditing(agent) {
    try {
      const data = await adminApi('GET', `/v1/admin/prompts/${encodeURIComponent(agent.id)}`);
      setEditContent(data.content || '');
      setEditing(agent);
    } catch (e) { setMessage({ text: e.message, type: 'error' }); }
  }

  async function savePrompt() {
    if (!editing) return;
    setSaving(true);
    setMessage(null);
    try {
      await adminApi('PUT', `/v1/admin/prompts/${encodeURIComponent(editing.id)}`, { content: editContent });
      setMessage({ text: `${editing.name} saved.`, type: 'success' });
      setEditing(null);
      load();
    } catch (e) { setMessage({ text: e.message, type: 'error' }); }
    finally { setSaving(false); }
  }

  if (loading) return <div className="flex items-center justify-center py-12 text-muted-foreground" role="status" aria-live="polite">Loading...</div>;

  // Agent prompt editor view
  if (editing) {
    return (
      <div>
        <div className="flex items-center gap-3 mb-1">
          <Button variant="ghost" size="sm" onClick={() => setEditing(null)} aria-label="Back to agents list">&larr; Back</Button>
          <h1 className="text-2xl font-bold">{editing.name}</h1>
        </div>
        <p className="text-sm text-muted-foreground mb-4">{editing.description}</p>

        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 mb-4 text-sm text-amber-800" role="alert">
          <strong>Caution:</strong> Changes to agent prompts take effect immediately for all learners. Incorrect prompts can break the learning experience. Test changes carefully.
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">System Prompt</CardTitle>
            <CardDescription>The instructions this agent receives.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Label htmlFor="agent-prompt-editor" className="sr-only">System prompt</Label>
            <Textarea id="agent-prompt-editor" className="font-mono text-sm min-h-[400px]" rows={20}
              value={editContent} onChange={e => setEditContent(e.target.value)} />
            <div className="flex items-center gap-3">
              <Button onClick={() => setConfirmAction({ type: 'prompt' })} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button>
              <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
              {message && <span role="status" aria-live="polite" className={`text-sm ${message.type === 'error' ? 'text-destructive' : 'text-green-700'}`}>{message.text}</span>}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Agents & Knowledge</h1>
      <p className="text-sm text-muted-foreground mb-4">
        The knowledge base is shared context injected into AI agents. Agent prompts define each agent's behavior.
      </p>

      {message && (
        <div className={`flex items-center justify-between rounded-lg px-4 py-3 mb-4 text-sm ${
          message.type === 'error' ? 'bg-destructive/10 text-destructive' : 'bg-green-50 text-green-800'
        }`} role="alert">
          <span>{message.text}</span>
          <button onClick={() => setMessage(null)} aria-label="Dismiss" className="ml-2 text-lg leading-none hover:opacity-70">&times;</button>
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList aria-label="Agents and knowledge sections">
          <TabsTrigger value="knowledge">Knowledge Base</TabsTrigger>
          <TabsTrigger value="agents">Agents</TabsTrigger>
        </TabsList>

        <TabsContent value="knowledge">
          <Card>
            <CardHeader>
              <CardTitle>Knowledge Base</CardTitle>
              <CardDescription>
                Program information, FAQs, and policies. Injected into the Coach and Course Creator agents so they can answer questions about your program.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {kbEditing ? (
                <>
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800" role="alert">
                    <strong>Caution:</strong> The knowledge base is injected into AI agents and affects how they respond to all learners. Verify accuracy before saving.
                  </div>
                  <Label htmlFor="kb-editor" className="sr-only">Knowledge base content</Label>
                  <Textarea id="kb-editor" className="font-mono text-sm min-h-[400px]" rows={20}
                    value={kbDraft} onChange={e => setKbDraft(e.target.value)}
                    placeholder="Enter program information, FAQs, policies..." />
                  <div className="flex items-center gap-3">
                    <Button onClick={() => setConfirmAction({ type: 'kb' })} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button>
                    <Button variant="outline" onClick={() => { setKbEditing(false); setKbDraft(knowledgeBase); }}>Cancel</Button>
                  </div>
                </>
              ) : (
                <>
                  {knowledgeBase ? (
                    <pre className="rounded-md bg-muted p-3 text-sm whitespace-pre-wrap max-h-[400px] overflow-y-auto">
                      {knowledgeBase}
                    </pre>
                  ) : (
                    <p className="text-muted-foreground py-4 text-center">No knowledge base content yet.</p>
                  )}
                  <Button variant="outline" onClick={() => { setKbDraft(knowledgeBase); setKbEditing(true); }}>
                    {knowledgeBase ? 'Edit' : 'Add Knowledge Base'}
                  </Button>
                </>
              )}
              <div className="flex items-center gap-2 text-xs text-muted-foreground pt-2">
                <span>Used by:</span>
                {AGENTS.filter(a => a.usesKB).map(a => (
                  <Badge key={a.id} variant="outline" className="text-xs">{a.name}</Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="agents">
          <div className="space-y-3">
            {AGENTS.map(agent => {
              const prompt = prompts[agent.id];
              return (
                <Card key={agent.id} className="hover:ring-1 hover:ring-primary/20 transition-shadow cursor-pointer"
                  role="button" tabIndex={0} aria-label={`Edit ${agent.name} agent`}
                  onClick={() => startEditing(agent)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); startEditing(agent); } }}>
                  <CardContent className="flex items-start gap-4">
                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold">{agent.name}</h3>
                        {agent.usesKB && <Badge variant="outline" className="text-xs">Uses Knowledge Base</Badge>}
                        {!prompt && <Badge variant="destructive" className="text-xs">Not seeded</Badge>}
                      </div>
                      <p className="text-sm text-muted-foreground">{agent.description}</p>
                      <div className="text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">Receives: </span>
                        {agent.receives.join(' · ')}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">Outputs: </span>
                        {agent.outputs.join(' · ')}
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" className="shrink-0 mt-1">Edit</Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>
      </Tabs>

      <AlertDialog open={!!confirmAction} onOpenChange={(open) => { if (!open) setConfirmAction(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction?.type === 'kb'
                ? 'This will update the knowledge base used by AI agents. Changes affect how agents respond to all learners immediately.'
                : `This will update the ${editing?.name || 'agent'} system prompt. Changes affect all learners immediately.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              const action = confirmAction;
              setConfirmAction(null);
              if (action?.type === 'kb') saveKB();
              else savePrompt();
            }}>
              Save Changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
