/**
 * LessonLoadingView — stepped build progress UI shown when starting a lesson.
 *
 * Shows 3 phases:
 * 1. Initializing lesson (Lesson Owner agent generates KB)
 * 2. Enriching lesson (plugins run — only shown if plugins are active)
 * 3. Starting conversation (Coach opens with first message)
 *
 * Each step shows a spinner + status. The enrichment step expands to show
 * per-plugin progress when multiple plugins are active.
 */

import { CheckCircle2, Circle, Loader2 } from 'lucide-react';

const STEPS = {
  INITIALIZING: 'initializing',
  ENRICHING: 'enriching',
  STARTING: 'starting',
};

function StepIcon({ status }) {
  if (status === 'completed') {
    return <CheckCircle2 className="w-5 h-5 text-green-600" aria-hidden="true" />;
  }
  if (status === 'in_progress') {
    return <Loader2 className="w-5 h-5 animate-spin text-blue-600" aria-hidden="true" />;
  }
  return <Circle className="w-5 h-5 text-gray-300" aria-hidden="true" />;
}

function BuildStep({ label, status, detail, enrichments }) {
  const isEnrichment = enrichments !== undefined;

  return (
    <div className="flex gap-3 mb-4">
      <div className="flex-shrink-0 mt-0.5">
        <StepIcon status={status} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-gray-900">
          {label}
        </div>
        {detail && (
          <div className="text-sm text-gray-600 mt-0.5">
            {detail}
          </div>
        )}
        {isEnrichment && enrichments.length > 0 && status === 'in_progress' && (
          <div className="mt-2 space-y-1">
            {enrichments.map((e, i) => (
              <div key={i} className="flex items-center gap-2 text-sm text-gray-600">
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                <span>{e.label || e.pluginId}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function LessonLoadingView({ step, enrichments = [] }) {
  const hasEnrichments = enrichments && enrichments.length > 0;

  // Compute step statuses based on current step
  const steps = [
    {
      key: STEPS.INITIALIZING,
      label: 'Initializing lesson',
      detail: 'The Lesson Owner is reviewing the objectives and creating your personalized learning plan',
      status: step === STEPS.INITIALIZING
        ? 'in_progress'
        : (step === STEPS.ENRICHING || step === STEPS.STARTING ? 'completed' : 'pending'),
    },
  ];

  // Only show enrichment step if plugins are active
  if (hasEnrichments) {
    steps.push({
      key: STEPS.ENRICHING,
      label: 'Enriching lesson',
      detail: 'Gathering relevant resources and context for this lesson',
      status: step === STEPS.ENRICHING
        ? 'in_progress'
        : (step === STEPS.STARTING ? 'completed' : 'pending'),
      enrichments,
    });
  }

  steps.push({
    key: STEPS.STARTING,
    label: 'Starting conversation',
    detail: 'Your coach is preparing to begin',
    status: step === STEPS.STARTING ? 'in_progress' : 'pending',
  });

  return (
    <div
      className="max-w-2xl mx-auto px-6 py-12"
      role="status"
      aria-live="polite"
      aria-label="Lesson is loading"
    >
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-6">
          Preparing your lesson
        </h2>
        <div>
          {steps.map((s) => (
            <BuildStep
              key={s.key}
              label={s.label}
              status={s.status}
              detail={s.detail}
              enrichments={s.enrichments}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// Export step constants so parent can use them
export { STEPS };
