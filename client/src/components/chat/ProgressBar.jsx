/**
 * Course progress meter -- simple bar driven by coach's progress score.
 */
export default function ProgressBar({ courseKB }) {
  if (!courseKB) return null;

  const progress = courseKB.progress ?? 0;
  const isComplete = courseKB.status === 'completed';
  const pct = isComplete ? 100 : progress * 10;

  return (
    <div
      className="mt-1.5"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-label={`Course progress: ${pct}% toward exemplar`}
    >
      <div className="flex justify-between text-xs text-muted-foreground mb-1" aria-hidden="true">
        <span>Starting</span>
        <span>{isComplete ? '\uD83C\uDF89 Exemplar Achieved!' : 'Exemplar'}</span>
      </div>
      <div className="h-1 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${isComplete ? 'bg-green-500' : 'bg-primary'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
