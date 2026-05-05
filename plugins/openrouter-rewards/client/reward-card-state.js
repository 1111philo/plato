export function shouldRenderCompletionRewardCard({ result, error }) {
  if (error) return true;
  return Boolean(result && result.status !== 'no-claim');
}
