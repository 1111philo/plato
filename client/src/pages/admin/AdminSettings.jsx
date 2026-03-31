import { useState, useEffect } from 'react';
import { adminApi } from './adminApi.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function AdminSettings() {
  const [message, setMessage] = useState(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetInput, setResetInput] = useState('');

  useEffect(() => {
    document.title = 'Settings — plato';
  }, []);

  async function resetAllSyncData() {
    if (resetInput !== 'RESET') return;
    try {
      const data = await adminApi('DELETE', '/v1/admin/sync');
      setMessage({ text: `Sync data reset: ${data.itemsDeleted} items deleted across ${data.usersAffected} users.`, type: 'success' });
      setShowResetConfirm(false);
      setResetInput('');
    } catch (e) { setMessage({ text: e.message, type: 'error' }); }
  }

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
