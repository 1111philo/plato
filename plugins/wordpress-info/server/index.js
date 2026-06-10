/**
 * WordPress Info plugin — server-side entry point.
 *
 * Registers a lessonStarted hook handler that orchestrates the 3-agent pipeline:
 * 1. Planner — decides whether to enrich and what to query
 * 2. Query executor — fetches from wordpress.org, Make blogs, GitHub
 * 3. Synthesizer — distills results into lesson-specific context
 *
 * Returns enrichment data: { context, sources, reasoning, pluginId, label }
 * The host stores this on `lessonKB.enrichments` and injects it into the coach.
 */

import { KEYWORDS, SOURCES } from './sources.js';
import { executeQueries } from './query-executor.js';
// Import orchestrator from client — plugins are bundled with full repo access
import * as orchestrator from '../../../client/js/orchestrator.js';

const PLANNER_SCHEMA = {
  type: 'object',
  properties: {
    shouldEnrich: { type: 'boolean' },
    reasoning: { type: 'string' },
    queries: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          sources: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: ['text', 'sources'],
      },
    },
  },
  required: ['shouldEnrich'],
};

const SYNTHESIZER_SCHEMA = {
  type: 'object',
  properties: {
    context: { type: 'string' },
    reasoning: { type: 'string' },
  },
  required: ['context', 'reasoning'],
};

/**
 * Load agent prompts. These would normally be upserted to sync-data as
 * `prompt:plugin:wordpress-info:<name>`, but for Phase 1 we'll read directly
 * from the files and call the orchestrator. Phase 3's `agent` capability will
 * formalize this.
 */
async function loadPrompt(name) {
  const fs = await import('fs/promises');
  const path = await import('path');
  const url = await import('url');
  const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
  const promptPath = path.join(__dirname, '../prompts', `${name}.md`);
  return fs.readFile(promptPath, 'utf-8');
}

/**
 * Call an agent with structured output. Returns the parsed JSON object.
 */
async function callAgentWithSchema(promptName, context, schema) {
  const prompt = await loadPrompt(promptName);
  const fullPrompt = `${prompt}\n\n${context}`;

  // Use converseStream but collect the full response
  // TODO: orchestrator needs a non-streaming variant for plugin use
  let response = '';
  await orchestrator.converseStream(
    'coach', // Use coach for now; Phase 3 will have plugin-specific agent names
    [{ role: 'user', content: fullPrompt }],
    (chunk) => { response = chunk; },
    2048
  );

  // Extract JSON from response (the agent should call StructuredOutput tool)
  // For now, parse the response as JSON directly
  try {
    const parsed = JSON.parse(response);
    // Validate against schema (basic check)
    if (schema.required) {
      for (const field of schema.required) {
        if (!(field in parsed)) {
          throw new Error(`Missing required field: ${field}`);
        }
      }
    }
    return parsed;
  } catch (err) {
    console.warn('[wordpress-info] Failed to parse agent response:', err);
    return null;
  }
}

/**
 * lessonStarted hook handler.
 */
async function onLessonStarted({ userId, lessonId, lesson, lessonKB }) {
  try {
    // Step 1: Call planner agent
    const plannerContext = `
**Exemplar:** ${lesson.exemplar || 'N/A'}

**Learning Objectives:**
${(lesson.learningObjectives || []).map(obj => `- ${obj}`).join('\n')}

**WordPress Keywords:** ${KEYWORDS.join(', ')}

Analyze this lesson and decide whether to enrich it with WordPress documentation.
`;

    const plan = await callAgentWithSchema('wordpress-info-planner', plannerContext, PLANNER_SCHEMA);
    if (!plan || !plan.shouldEnrich || !plan.queries || !plan.queries.length) {
      // Not WordPress-related or planner failed — no enrichment
      return null;
    }

    // Step 2: Execute queries
    const queryResults = await executeQueries(plan.queries, SOURCES);

    // If no results, don't synthesize
    const totalResults = queryResults.reduce((sum, q) => sum + q.results.length, 0);
    if (totalResults === 0) {
      return null;
    }

    // Step 3: Call synthesizer agent
    const resultsText = queryResults.map(qr => {
      const resultsStr = qr.results.map(r =>
        `**${r.title}**\n${r.excerpt}\nURL: ${r.url}`
      ).join('\n\n');
      return `### Query: ${qr.query}\n\n${resultsStr}`;
    }).join('\n\n---\n\n');

    const synthesizerContext = `
**Lesson Exemplar:** ${lesson.exemplar || 'N/A'}

**Learning Objectives:**
${(lesson.learningObjectives || []).map(obj => `- ${obj}`).join('\n')}

**Query Results:**

${resultsText}

Synthesize a concise, lesson-specific context note (~300 words).
`;

    const synthesis = await callAgentWithSchema('wordpress-info-synthesizer', synthesizerContext, SYNTHESIZER_SCHEMA);
    if (!synthesis || !synthesis.context) {
      return null;
    }

    // Step 4: Collect sources for citation
    const allSources = [];
    const seen = new Set();
    for (const qr of queryResults) {
      for (const r of qr.results) {
        if (r.url && !seen.has(r.url)) {
          seen.add(r.url);
          allSources.push({
            url: r.url,
            title: r.title,
            excerpt: r.excerpt,
          });
        }
      }
    }

    // Return enrichment data
    return {
      pluginId: 'wordpress-info',
      label: 'WordPress.org',
      context: synthesis.context,
      reasoning: synthesis.reasoning,
      sources: allSources.slice(0, 8), // Cap at 8 sources
    };
  } catch (err) {
    // Fail open — never block lesson start
    console.error('[wordpress-info] Enrichment failed:', err);
    return null;
  }
}

export default {
  hooks: {
    lessonStarted: onLessonStarted,
  },
};
