/**
 * EnrichmentArtifact — displays lesson enrichment data from plugins.
 *
 * Shows above the first coach message, collapsible by default. Displays:
 * - Plugin label (e.g., "WordPress.org")
 * - Reasoning (why this context matters)
 * - Context summary (reference material)
 * - Source links (clickable, open in new tab)
 *
 * The coach draws on this context but it never overrides completion semantics.
 */

import { useState } from 'react';
import { ChevronDown, ChevronRight, ExternalLink, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function EnrichmentArtifact({ enrichment }) {
  const [expanded, setExpanded] = useState(false);

  if (!enrichment) return null;

  const { label, reasoning, context, sources, pluginId } = enrichment;
  const displayLabel = label || pluginId || 'Additional Context';

  return (
    <div className="mx-3 my-4 border border-blue-200 bg-blue-50 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-blue-100 transition-colors"
        aria-expanded={expanded}
        aria-controls={`enrichment-${pluginId}`}
      >
        <div className="flex-shrink-0 text-blue-600">
          {expanded ? (
            <ChevronDown className="w-5 h-5" aria-hidden="true" />
          ) : (
            <ChevronRight className="w-5 h-5" aria-hidden="true" />
          )}
        </div>
        <div className="flex-shrink-0 text-blue-600">
          <Info className="w-5 h-5" aria-hidden="true" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-blue-900">
            {displayLabel}
          </div>
          {!expanded && reasoning && (
            <div className="text-sm text-blue-700 truncate mt-0.5">
              {reasoning}
            </div>
          )}
        </div>
        <div className="flex-shrink-0 text-xs text-blue-600 font-medium">
          {expanded ? 'Hide' : 'Show'} details
        </div>
      </button>

      {expanded && (
        <div id={`enrichment-${pluginId}`} className="px-4 pb-4 space-y-3">
          {reasoning && (
            <div>
              <div className="text-xs font-semibold text-blue-800 uppercase tracking-wide mb-1">
                Why this context matters
              </div>
              <div className="text-sm text-gray-700">
                {reasoning}
              </div>
            </div>
          )}

          {context && (
            <div>
              <div className="text-xs font-semibold text-blue-800 uppercase tracking-wide mb-1">
                Reference Material
              </div>
              <div className="text-sm text-gray-700 whitespace-pre-wrap">
                {context}
              </div>
            </div>
          )}

          {sources && sources.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-blue-800 uppercase tracking-wide mb-1">
                Sources
              </div>
              <ul className="space-y-2">
                {sources.map((source, idx) => (
                  <li key={idx}>
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-sm text-blue-700 hover:text-blue-900 hover:underline"
                    >
                      <ExternalLink className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
                      <span>{source.title || source.url}</span>
                    </a>
                    {source.excerpt && (
                      <div className="text-xs text-gray-600 mt-0.5 ml-5">
                        {source.excerpt}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
