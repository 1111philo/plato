import { useId, useState } from 'react';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right';
import { activitySummary } from '../../lib/agentActivity.js';

/**
 * "Behind this response" (#411): a collapsed disclosure between a message and
 * the reply it got, listing the agents that worked on the reply, what each
 * read, and what it did (lib/agentActivity.js builds `agents`). A real
 * button with aria-expanded, so it's reachable by Tab inside the chat log.
 */
export default function AgentActivity({ agents }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  if (!Array.isArray(agents) || agents.length === 0) return null;
  const summary = activitySummary(agents);

  return (
    <div className="my-1">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        // The visible "·" reads poorly; the name keeps the visible words in order (WCAG 2.5.3).
        aria-label={`Behind this response: ${summary}`}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 rounded-sm px-1 py-0.5 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      >
        <ChevronRight aria-hidden="true" className={`h-3.5 w-3.5 motion-safe:transition-transform ${open ? 'rotate-90' : ''}`} />
        <span>Behind this response</span>
        <span aria-hidden="true">·</span>
        <span>{summary}</span>
      </button>
      <div id={panelId} hidden={!open} className="mt-1 ml-1 border-l-2 border-muted pl-3">
        <ul className="space-y-3 text-sm">
          {agents.map((a, i) => (
            <li key={`${a.agent}-${i}`}>
              <p className="font-medium">{a.label}</p>
              {a.read && (
                <p className="text-muted-foreground"><span className="font-medium">Read:</span> {a.read.join('; ')}</p>
              )}
              {a.did && (
                <ul className="list-disc pl-5">
                  {a.did.map((d, j) => <li key={j}>{d}</li>)}
                </ul>
              )}
              {a.notes && (
                <>
                  <p className="text-muted-foreground mt-1">Notes:</p>
                  <ul className="list-disc pl-5 text-muted-foreground">
                    {a.notes.map((n, j) => <li key={j}>{n}</li>)}
                  </ul>
                </>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
