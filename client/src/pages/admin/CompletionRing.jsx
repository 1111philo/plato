// SVG donut showing completed / available lessons as a percentage.
// Thresholds match plato's pacing-dashboard pattern (green / yellow / red).
//   0–34 %  → red    (struggling)
//   35–89 % → yellow (in progress)
//   90 %+   → green  (nearly done)
// `size` controls the outer pixel size; a `compact` flag hides the
// secondary "N of M" caption (used for the table-cell variant).

function colorForPercent(p) {
  if (p == null) return { stroke: 'text-muted-foreground', text: 'text-muted-foreground' };
  if (p >= 90) return { stroke: 'text-green-500', text: 'text-green-700' };
  if (p >= 35) return { stroke: 'text-yellow-500', text: 'text-yellow-700' };
  return { stroke: 'text-red-500', text: 'text-red-700' };
}

export default function CompletionRing({
  completed,
  available,
  size = 80,
  strokeWidth = 8,
  label,
  compact = false,
}) {
  const hasData = typeof completed === 'number' && typeof available === 'number' && available > 0;
  const rawPct = hasData ? (completed / available) * 100 : null;
  const pct = rawPct != null ? Math.min(100, Math.round(rawPct)) : null;
  const { stroke, text } = colorForPercent(pct);

  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = pct != null ? circumference * (1 - pct / 100) : circumference;
  const fontSize = compact ? size * 0.32 : size * 0.28;
  const ariaLabel = hasData
    ? `${label || 'Completion'}: ${pct}% (${completed} of ${available})`
    : `${label || 'Completion'}: no data`;

  return (
    <div className="flex flex-col items-center gap-1" role="img" aria-label={ariaLabel}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" strokeWidth={strokeWidth}
          className="text-muted/40" stroke="currentColor"
        />
        {pct != null && pct > 0 && (
          <circle
            cx={size / 2} cy={size / 2} r={radius}
            fill="none" strokeWidth={strokeWidth} strokeLinecap="round"
            className={stroke} stroke="currentColor"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        )}
        <text
          x="50%" y="50%"
          dominantBaseline="central" textAnchor="middle"
          className={`${text} font-semibold tabular-nums`}
          style={{ fontSize: `${fontSize}px` }}
        >
          {pct != null ? `${pct}%` : '—'}
        </text>
      </svg>
      {!compact && (
        <div className="text-xs text-muted-foreground text-center leading-tight">
          {hasData ? (
            <>
              {label && <div>{label}</div>}
              <div>{completed} of {available}</div>
            </>
          ) : (
            <div>{label || 'No lessons available'}</div>
          )}
        </div>
      )}
    </div>
  );
}
