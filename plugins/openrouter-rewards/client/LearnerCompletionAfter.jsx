import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { authenticatedFetch } from '../../../client/js/auth.js';

export default function LearnerCompletionAfter({ lessonId }) {
  const checkedRef = useRef(null);
  const cardRef = useRef(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!lessonId || checkedRef.current === lessonId) return;
    checkedRef.current = lessonId;
    let cancelled = false;
    setError('');
    setResult(null);
    (async () => {
      try {
        const res = await authenticatedFetch('/v1/plugins/openrouter-rewards/check-pending', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lessonId }),
        });
        const data = await res.json();
        if (!cancelled) {
          if (!res.ok) setError(data.error || 'Reward request failed');
          else {
            setError('');
            setResult(data);
          }
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    })();
    return () => { cancelled = true; };
  }, [lessonId]);

  useEffect(() => {
    if (!result || result.status === 'no-claim') return;
    cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [result]);

  if (!result || result.status === 'no-claim') return null;

  return (
    <Card ref={cardRef} className="border-primary/40 bg-primary/5" role="status" aria-live="polite">
      <CardContent className="space-y-3">
        {result.status === 'processing' && <p className="text-sm">Reward is being prepared.</p>}
        {result.status === 'topped-up' && <p className="text-sm">Your OpenRouter key limit increased by ${result.addedCredit}.</p>}
        {result.status === 'minted' && <RevealKey plaintext={result.plaintext} />}
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      </CardContent>
    </Card>
  );
}

function RevealKey({ plaintext }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-2">
      <p className="text-sm">Your OpenRouter API key is ready. Copy it now — it won't be shown again.</p>
      <code className="block break-all rounded bg-muted p-2 text-xs">{plaintext}</code>
      <Button
        variant="outline"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(plaintext);
            setCopied(true);
          } catch {
            // Clipboard write can fail in insecure contexts; the key is still visible on the page.
          }
        }}
      >
        {copied ? 'Copied' : 'Copy key'}
      </Button>
    </div>
  );
}
