import { useEffect, useRef, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { authenticatedFetch } from '../../../client/js/auth.js';
import RevealKey from './RevealKey.jsx';
import { shouldRenderCompletionRewardCard } from './reward-card-state.js';

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

  if (!shouldRenderCompletionRewardCard({ result, error })) return null;

  return (
    <Card ref={cardRef} className="border-primary/40 bg-primary/5" role="status" aria-live="polite">
      <CardContent className="space-y-3">
        {result?.status === 'processing' && <p className="text-sm">Reward is being prepared.</p>}
        {result?.status === 'topped-up' && <p className="text-sm">Your OpenRouter key limit increased by ${result.addedCredit}.</p>}
        {result?.status === 'minted' && (
          <RevealKey
            plaintext={result.plaintext}
            intro="Your OpenRouter API key is ready. Copy it now; it won't be shown again."
          />
        )}
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      </CardContent>
    </Card>
  );
}
