import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminApi } from './adminApi.js';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

const TYPE_LABELS = {
  prompt: 'Prompt',
  course: 'Course',
  knowledgeBase: 'Knowledge Base',
};

export default function AdminContentUpdates() {
  const [updates, setUpdates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState({});
  const [acting, setActing] = useState({});
  const [message, setMessage] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    document.title = 'Content Updates — plato';
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const data = await adminApi('GET', '/v1/admin/content-updates');
      setUpdates(data.updates || []);
    } catch (e) {
      setMessage({ text: e.message, type: 'error' });
    }
    setLoading(false);
  }

  async function accept(dataKey) {
    setActing(a => ({ ...a, [dataKey]: 'accepting' }));
    try {
      await adminApi('POST', '/v1/admin/content-updates/accept', { dataKey });
      setUpdates(u => u.filter(item => item.dataKey !== dataKey));
      setMessage({ text: `Accepted update for ${dataKey}.`, type: 'success' });
    } catch (e) {
      setMessage({ text: e.message, type: 'error' });
    }
    setActing(a => ({ ...a, [dataKey]: null }));
  }

  async function dismiss(dataKey) {
    setActing(a => ({ ...a, [dataKey]: 'dismissing' }));
    try {
      await adminApi('POST', '/v1/admin/content-updates/dismiss', { dataKey });
      setUpdates(u => u.filter(item => item.dataKey !== dataKey));
      setMessage({ text: `Dismissed update for ${dataKey}.`, type: 'success' });
    } catch (e) {
      setMessage({ text: e.message, type: 'error' });
    }
    setActing(a => ({ ...a, [dataKey]: null }));
  }

  async function acceptAll() {
    setActing({ _all: 'accepting' });
    try {
      for (const item of updates) {
        await adminApi('POST', '/v1/admin/content-updates/accept', { dataKey: item.dataKey });
      }
      setUpdates([]);
      setMessage({ text: 'All updates accepted.', type: 'success' });
    } catch (e) {
      setMessage({ text: e.message, type: 'error' });
      await load();
    }
    setActing({});
  }

  function toggleExpanded(dataKey) {
    setExpanded(e => ({ ...e, [dataKey]: !e[dataKey] }));
  }

  if (loading) {
    return <div className="flex items-center justify-center py-12 text-muted-foreground" role="status" aria-live="polite">Loading...</div>;
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-1">
        <Button variant="ghost" size="sm" onClick={() => navigate('/plato')} aria-label="Back to dashboard">&larr; Back</Button>
        <h1 className="text-2xl font-bold">Content Updates</h1>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        The latest version of plato includes updated content. Review each change and choose to accept or dismiss it.
      </p>

      {message && (
        <div className={`flex items-center justify-between rounded-lg px-4 py-3 mb-4 text-sm ${
          message.type === 'error' ? 'bg-destructive/10 text-destructive' : 'bg-green-50 text-green-800'
        }`} role="alert">
          <span>{message.text}</span>
          <button onClick={() => setMessage(null)} aria-label="Dismiss message" className="ml-2 text-lg leading-none hover:opacity-70">&times;</button>
        </div>
      )}

      {updates.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p>All content is up to date.</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate('/plato')}>Back to Dashboard</Button>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm text-muted-foreground">{updates.length} update{updates.length !== 1 ? 's' : ''} available</span>
            <Button
              variant="outline"
              size="sm"
              onClick={acceptAll}
              disabled={!!acting._all}
              aria-label="Accept all updates"
            >
              {acting._all ? 'Accepting...' : 'Accept All'}
            </Button>
          </div>

          <div className="space-y-4">
            {updates.map(item => (
              <Card key={item.dataKey}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-base">{item.name}</CardTitle>
                      <Badge variant="outline" className="text-xs">{TYPE_LABELS[item.type] || item.type}</Badge>
                      {item.isNew && <Badge className="text-xs">New</Badge>}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleExpanded(item.dataKey)}
                        aria-expanded={!!expanded[item.dataKey]}
                        aria-label={expanded[item.dataKey] ? 'Hide changes' : 'Show changes'}
                      >
                        {expanded[item.dataKey] ? 'Hide changes' : 'Show changes'}
                      </Button>
                      {!item.isNew && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => dismiss(item.dataKey)}
                          disabled={!!acting[item.dataKey] || !!acting._all}
                          aria-label={`Dismiss update for ${item.name}`}
                        >
                          {acting[item.dataKey] === 'dismissing' ? 'Dismissing...' : 'Dismiss'}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        onClick={() => accept(item.dataKey)}
                        disabled={!!acting[item.dataKey] || !!acting._all}
                        aria-label={`Accept update for ${item.name}`}
                      >
                        {acting[item.dataKey] === 'accepting' ? 'Accepting...' : 'Accept'}
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                {expanded[item.dataKey] && (
                  <CardContent>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {!item.isNew && (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-1">Current (in database)</p>
                          <pre className="rounded-md bg-red-50 border border-red-200 p-3 text-xs whitespace-pre-wrap max-h-[400px] overflow-y-auto">
                            {item.currentContent}
                          </pre>
                        </div>
                      )}
                      <div className={item.isNew ? 'col-span-full' : ''}>
                        <p className="text-xs font-medium text-muted-foreground mb-1">{item.isNew ? 'New content' : 'Updated (from plato)'}</p>
                        <pre className="rounded-md bg-green-50 border border-green-200 p-3 text-xs whitespace-pre-wrap max-h-[400px] overflow-y-auto">
                          {item.newContent}
                        </pre>
                      </div>
                    </div>
                  </CardContent>
                )}
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
