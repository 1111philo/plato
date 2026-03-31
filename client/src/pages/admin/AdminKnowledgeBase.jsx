import { useState, useEffect } from 'react';
import { adminApi } from './adminApi.js';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';

export default function AdminKnowledgeBase() {
  const [knowledgeBase, setKnowledgeBase] = useState('');
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    document.title = 'Knowledge Base — plato';
    loadKB();
  }, []);

  async function loadKB() {
    setLoading(true);
    try {
      const kb = await adminApi('GET', '/v1/admin/knowledge-base');
      setKnowledgeBase(kb.content || '');
    } catch { /* ignore */ }
    setLoading(false);
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      await adminApi('PUT', '/v1/admin/knowledge-base', { content: knowledgeBase });
      setMessage({ text: 'Knowledge base saved.', type: 'success' });
      setEditing(false);
    } catch (e) {
      setMessage({ text: e.message, type: 'error' });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="flex items-center justify-center py-12 text-muted-foreground">Loading...</div>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Knowledge Base</h1>
      <p className="text-sm text-muted-foreground mb-4">
        This content is injected into the AI coach's system prompt so it can answer questions about your program, organization, or policies.
      </p>

      <Card>
        <CardContent className="space-y-4">
          {editing ? (
            <>
              <Textarea
                className="font-mono text-sm min-h-[400px]"
                rows={20}
                value={knowledgeBase}
                onChange={e => setKnowledgeBase(e.target.value)}
                placeholder="Enter program information, FAQs, policies, or any context the AI coach should know about..."
              />
              <div className="flex items-center gap-3">
                <Button onClick={save} disabled={saving}>
                  {saving ? 'Saving...' : 'Save'}
                </Button>
                <Button variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
                {message && (
                  <span className={`text-sm ${message.type === 'error' ? 'text-destructive' : 'text-green-700'}`}>
                    {message.text}
                  </span>
                )}
              </div>
            </>
          ) : (
            <>
              {knowledgeBase ? (
                <pre className="rounded-md bg-muted p-3 text-sm overflow-x-auto whitespace-pre-wrap max-h-[300px] overflow-y-auto">
                  {knowledgeBase}
                </pre>
              ) : (
                <p className="text-muted-foreground py-4 text-center">No knowledge base content yet.</p>
              )}
              <Button variant="outline" onClick={() => setEditing(true)}>
                {knowledgeBase ? 'Edit Knowledge Base' : 'Add Knowledge Base'}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
