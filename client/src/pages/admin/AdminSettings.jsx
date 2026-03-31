import { useState, useEffect } from 'react';
import { adminApi } from './adminApi.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';

export default function AdminSettings() {
  const [knowledgeBase, setKnowledgeBase] = useState('');
  const [kbEditing, setKbEditing] = useState(false);
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetInput, setResetInput] = useState('');

  useEffect(() => {
    document.title = 'Settings — plato';
    loadSettings();
  }, []);

  async function loadSettings() {
    setLoading(true);
    try {
      const kb = await adminApi('GET', '/v1/admin/knowledge-base');
      setKnowledgeBase(kb.content || '');
    } catch { /* ignore */ }
    setLoading(false);
  }

  async function saveKnowledgeBase() {
    try {
      await adminApi('PUT', '/v1/admin/knowledge-base', { content: knowledgeBase });
      setMessage({ text: 'Knowledge base saved.', type: 'success' });
      setKbEditing(false);
    } catch (e) { setMessage({ text: e.message, type: 'error' }); }
  }

  async function resetAllSyncData() {
    if (resetInput !== 'RESET') return;
    try {
      const data = await adminApi('DELETE', '/v1/admin/sync');
      setMessage({ text: `Sync data reset: ${data.itemsDeleted} items deleted across ${data.usersAffected} users.`, type: 'success' });
      setShowResetConfirm(false);
      setResetInput('');
    } catch (e) { setMessage({ text: e.message, type: 'error' }); }
  }

  if (loading) return <div className="flex items-center justify-center py-12 text-muted-foreground">Loading...</div>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Settings</h1>

      {message && (
        <div className={`flex items-center justify-between rounded-lg px-4 py-3 mb-4 text-sm ${
          message.type === 'error' ? 'bg-destructive/10 text-destructive' : 'bg-green-50 text-green-800'
        }`} role="alert">
          <span>{message.text}</span>
          <button onClick={() => setMessage(null)} aria-label="Dismiss" className="ml-2 text-lg leading-none hover:opacity-70">&times;</button>
        </div>
      )}

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Knowledge Base</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">Injected into the coach system prompt so it can answer program questions.</p>
          {kbEditing ? (
            <>
              <Textarea className="font-mono text-sm min-h-[300px]" rows={15}
                value={knowledgeBase} onChange={e => setKnowledgeBase(e.target.value)} />
              <div className="flex gap-2">
                <Button onClick={saveKnowledgeBase}>Save</Button>
                <Button variant="outline" onClick={() => setKbEditing(false)}>Cancel</Button>
              </div>
            </>
          ) : (
            <>
              <pre className="rounded-md bg-muted p-3 text-sm overflow-x-auto whitespace-pre-wrap max-h-[200px] overflow-y-auto">
                {knowledgeBase.slice(0, 500)}{knowledgeBase.length > 500 ? '...' : ''}
              </pre>
              <Button variant="outline" onClick={() => setKbEditing(true)}>Edit Knowledge Base</Button>
            </>
          )}
        </CardContent>
      </Card>

      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="text-destructive">Danger Zone</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">Reset synced data for all users. This cannot be undone.</p>
          {!showResetConfirm ? (
            <Button variant="destructive" onClick={() => setShowResetConfirm(true)}>Reset all sync data</Button>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="reset-confirm" className="text-amber-600">Type RESET to confirm</Label>
              <div className="flex gap-2">
                <Input id="reset-confirm" value={resetInput} onChange={e => setResetInput(e.target.value)}
                  placeholder="RESET" className="flex-1"
                  onKeyDown={e => {
                    if (e.key === 'Enter' && resetInput === 'RESET') resetAllSyncData();
                    if (e.key === 'Escape') { setShowResetConfirm(false); setResetInput(''); }
                  }} />
                <Button variant="destructive" disabled={resetInput !== 'RESET'} onClick={resetAllSyncData}>Reset</Button>
                <Button variant="outline" onClick={() => { setShowResetConfirm(false); setResetInput(''); }}>Cancel</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
