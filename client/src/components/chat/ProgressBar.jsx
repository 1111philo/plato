/**
 * Course progress meter — red-to-green gradient driven by coach's progress score.
 */
export default function ProgressBar({ courseKB }) {
  if (!courseKB) return null;

  const progress = courseKB.progress ?? 0;
  const isComplete = courseKB.status === 'completed';
  const pct = isComplete ? 100 : progress * 10;

  return (
    <div
      className="creation-meter"
      style={{ marginTop: '6px' }}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-label={`Course progress: ${pct}% toward exemplar`}
    >
      <div className="creation-meter-labels" aria-hidden="true">
        <span>Starting</span>
        <span>Exemplar</span>
      </div>
      <div className="creation-meter-track">
        <div className={`creation-meter-overlay${isComplete ? ' meter-complete' : ''}`} style={{ width: `${100 - pct}%` }} />
      </div>
    </div>
  );
}
