import { useState, useEffect } from 'react';
import { adminApi } from './adminApi.js';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';

const AGENTS = [
  {
    id: 'coach',
    name: 'Coach',
    description: 'The learner\'s companion in a continuous conversation. Coaches toward the exemplar, creates activities inline, evaluates submissions (text and images), and tracks progress.',
    receives: ['Course knowledge base', 'Learner profile summary', 'Conversation history', 'Knowledge base (program info)'],
    outputs: ['Coaching responses', 'Inline activities', 'Progress updates [PROGRESS: 0-10]', 'KB updates [KB_UPDATE]', 'Profile updates [PROFILE_UPDATE]'],
    hasKnowledgeBase: true,
  },
  {
    id: 'course-creator',
    name: 'Course Creator',
    description: 'Guides users through designing custom courses via conversational chat. Helps define an exemplar and learning objectives.',
    receives: ['Conversation history', 'Knowledge base (program info)'],
    outputs: ['Coaching responses', 'Readiness signal [READINESS: 0-10]'],
    hasKnowledgeBase: true,
  },
  {
    id: 'course-owner',
    name: 'Course Owner',
    description: 'Initializes a course knowledge base from the course prompt. Produces structured objectives with evidence descriptors, initial learner position, and insights.',
    receives: ['Course prompt (exemplar + objectives)', 'Learner profile summary'],
    outputs: ['Structured course KB (JSON)'],
  },
  {
    id: 'course-extractor',
    name: 'Course Extractor',
    description: 'Extracts structured course markdown from a course creation conversation.',
    receives: ['Course creation conversation text'],
    outputs: ['Course markdown (title, description, exemplar, objectives)'],
  },
  {
    id: 'learner-profile-owner',
    name: 'Learner Profile Owner',
    description: 'Deep profile update when a learner completes a course. Revises the profile based on everything demonstrated during the course.',
    receives: ['Current learner profile', 'Course KB', 'Course name', 'Activities completed count'],
    outputs: ['Updated learner profile (JSON)'],
  },
  {
    id: 'learner-profile-update',
    name: 'Learner Profile Update',
    description: 'Incremental profile update from direct learner feedback or observations.',
    receives: ['Current learner profile', 'Learner feedback text', 'Activity context'],
    outputs: ['Updated profile fields (JSON)'],
  },
];

export default function AdminAgents() {
  const [prompts, setPrompts] = useState({});
  const [knowledgeBase, setKnowledgeBase] = useState('');
  const [editing, setEditing] = useState(null); // { id, name }
  const [editContent, setEditContent] = useState('');
  const [editKB, setEditKB] = useState('');
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    document.title = 'Agents — plato';
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
      for (const p of (Array.isArray(promptList) ? promptList : [])) {
        map[p.name] = p;
      }
      setPrompts(map);
      setKnowledgeBase(kb.content || '');
    } catch { /* ignore */ }
    setLoading(false);
  }

  async function startEditing(agent) {
    try {
      const data = await adminApi('GET', `/v1/admin/prompts/${encodeURIComponent(agent.id)}`);
      setEditContent(data.content || '');
      setEditKB(agent.hasKnowledgeBase ? knowledgeBase : '');
      setEditing(agent);
    } catch (e) { setMessage({ text: e.message, type: 'error' }); }
  }

  async function save() {
    if (!editing) return;
    setSaving(true);
    setMessage(null);
    try {
      await adminApi('PUT', `/v1/admin/prompts/${encodeURIComponent(editing.id)}`, { content: editContent });
      if (editing.hasKnowledgeBase && editKB !== knowledgeBase) {
        await adminApi('PUT', '/v1/admin/knowledge-base', { content: editKB });
        setKnowledgeBase(editKB);
      }
      setMessage({ text: `${editing.name} agent saved. Changes take effect immediately.`, type: 'success' });
      setEditing(null);
      load();
    } catch (e) {
      setMessage({ text: e.message, type: 'error' });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="flex items-center justify-center py-12 text-muted-foreground">Loading...</div>;

  if (editing) {
    return (
      <div>
        <div className="flex items-center gap-3 mb-4">
          <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>&larr; Back</Button>
          <h1 className="text-2xl font-bold">{editing.name}</h1>
        </div>
        <p className="text-sm text-muted-foreground mb-4">{editing.description}</p>

        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="text-base">System Prompt</CardTitle>
            <CardDescription>The instructions this agent receives. Changes take effect immediately.</CardDescription>
          </CardHeader>
          <CardContent>
            <Textarea
              className="font-mono text-sm min-h-[400px]"
              rows={20}
              value={editContent}
              onChange={e => setEditContent(e.target.value)}
            />
          </CardContent>
        </Card>

        {editing.hasKnowledgeBase && (
          <Card className="mb-4">
            <CardHeader>
              <CardTitle className="text-base">Knowledge Base</CardTitle>
              <CardDescription>Program information appended to this agent's system prompt. Shared across all agents that receive it.</CardDescription>
            </CardHeader>
            <CardContent>
              <Textarea
                className="font-mono text-sm min-h-[200px]"
                rows={10}
                value={editKB}
                onChange={e => setEditKB(e.target.value)}
                placeholder="Program info, FAQs, policies..."
              />
            </CardContent>
          </Card>
        )}

        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
          <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
          {message && (
            <span className={`text-sm ${message.type === 'error' ? 'text-destructive' : 'text-green-700'}`}>
              {message.text}
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Agents</h1>
      <p className="text-sm text-muted-foreground mb-4">
        These AI agents power the learning experience. Each has a system prompt that defines its behavior. Changes take effect immediately.
      </p>

      {message && (
        <div className={`flex items-center justify-between rounded-lg px-4 py-3 mb-4 text-sm ${
          message.type === 'error' ? 'bg-destructive/10 text-destructive' : 'bg-green-50 text-green-800'
        }`} role="alert">
          <span>{message.text}</span>
          <button onClick={() => setMessage(null)} aria-label="Dismiss" className="ml-2 text-lg leading-none hover:opacity-70">&times;</button>
        </div>
      )}

      <div className="space-y-3">
        {AGENTS.map(agent => {
          const prompt = prompts[agent.id];
          return (
            <Card key={agent.id} className="hover:ring-1 hover:ring-primary/20 transition-shadow cursor-pointer"
              onClick={() => startEditing(agent)}>
              <CardContent className="flex items-start gap-4">
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold">{agent.name}</h3>
                    {agent.hasKnowledgeBase && <Badge variant="outline" className="text-xs">+ Knowledge Base</Badge>}
                    {!prompt && <Badge variant="destructive" className="text-xs">Not seeded</Badge>}
                  </div>
                  <p className="text-sm text-muted-foreground">{agent.description}</p>
                  <div className="flex gap-6 text-xs text-muted-foreground">
                    <div>
                      <span className="font-medium text-foreground">Receives:</span>{' '}
                      {agent.receives.join(', ')}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">Outputs:</span>{' '}
                    {agent.outputs.join(', ')}
                  </div>
                </div>
                <Button variant="ghost" size="sm" className="shrink-0 mt-1">Edit</Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
