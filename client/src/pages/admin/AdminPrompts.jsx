import { useState, useEffect } from 'react';
import { adminApi } from './adminApi.js';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';

export default function AdminPrompts() {
  const [prompts, setPrompts] = useState([]);
  const [editing, setEditing] = useState(null); // { name, content }
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.title = 'Prompts — Admin';
    loadPrompts();
  }, []);

  async function loadPrompts() {
    setLoading(true);
    try {
      const data = await adminApi('GET', '/v1/admin/prompts');
      setPrompts(Array.isArray(data) ? data : []);
    } catch { /* ignore */ }
    setLoading(false);
  }

  async function editPrompt(name) {
    try {
      const data = await adminApi('GET', `/v1/admin/prompts/${encodeURIComponent(name)}`);
      setEditing({ name, content: data.content || '' });
    } catch (e) { setMessage({ text: e.message, type: 'error' }); }
  }

  async function savePrompt() {
    if (!editing) return;
    try {
      await adminApi('PUT', `/v1/admin/prompts/${encodeURIComponent(editing.name)}`, {
        content: editing.content,
      });
      setMessage({ text: `Prompt "${editing.name}" saved.`, type: 'success' });
      setEditing(null);
      loadPrompts();
    } catch (e) { setMessage({ text: e.message, type: 'error' }); }
  }

  if (loading) return <div className="flex items-center justify-center py-12 text-muted-foreground">Loading...</div>;

  if (editing) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-4">Edit: {editing.name}</h1>
        <Card>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="prompt-content">System Prompt</Label>
              <Textarea
                id="prompt-content"
                className="font-mono text-sm min-h-[500px]"
                rows={25}
                value={editing.content}
                onChange={e => setEditing({ ...editing, content: e.target.value })}
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={savePrompt}>Save</Button>
              <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">System Prompts</h1>

      {message && (
        <div
          className={`flex items-center justify-between rounded-lg px-4 py-3 mb-4 text-sm ${
            message.type === 'error'
              ? 'bg-destructive/10 text-destructive'
              : 'bg-green-50 text-green-800 dark:bg-green-900/20 dark:text-green-400'
          }`}
          role="alert"
        >
          <span>{message.text}</span>
          <button onClick={() => setMessage(null)} aria-label="Dismiss" className="ml-2 text-lg leading-none hover:opacity-70">&times;</button>
        </div>
      )}

      <p className="text-muted-foreground mb-4">These prompts drive the AI agents. Changes take effect immediately.</p>

      <Card className="p-0 overflow-hidden">
        <Table aria-label="System prompts">
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead><span className="sr-only">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {prompts.map(p => (
              <TableRow key={p.name}>
                <TableCell><code className="text-sm bg-muted px-1.5 py-0.5 rounded">{p.name}</code></TableCell>
                <TableCell>{p.updatedAt ? new Date(p.updatedAt).toLocaleDateString() : '\u2014'}</TableCell>
                <TableCell>
                  <Button variant="ghost" size="icon-xs" title="Edit" onClick={() => editPrompt(p.name)}>&#9998;</Button>
                </TableCell>
              </TableRow>
            ))}
            {prompts.length === 0 && (
              <TableRow>
                <TableCell colSpan={3} className="text-center py-6 text-muted-foreground">No prompts seeded yet. Run the seed script.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
