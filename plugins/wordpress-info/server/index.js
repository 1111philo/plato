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
 *
 * Trace mode (#595): when the learner is recording, the host hands this call
 * a recorder (`ctx.trace`, with `ctx.trace.on` true). Both AI calls are
 * recorded by the host's wrapper around `ctx.ai` (named by the `purpose`
 * passed to `invoke`), each search goes through `ctx.trace.fetch`, and the
 * decisions in between are notes. Untraced, none of that runs.
 */

import { KEYWORDS, SOURCES } from './sources.js';
import { executeQueries } from './query-executor.js';

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
 * Prompts are read from the plugin's own files, not upserted to sync-data as
 * `prompt:plugin:wordpress-info:<name>`. Phase 3's `agent` capability will
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
 * `purpose` names the call in a trace; the provider ignores it otherwise.
 */
async function callAgentWithSchema(promptName, context, schema, ai, model, purpose) {
  const prompt = await loadPrompt(promptName);
  const fullPrompt = `${prompt}\n\n${context}`;

  const response = await ai.invoke(model, {
    max_tokens: 2048,
    messages: [{ role: 'user', content: fullPrompt }],
  }, { purpose });

  let text = response.content?.find(c => c.type === 'text')?.text || '';

  // Extract JSON from <StructuredOutput> tags or find JSON object in text
  const structuredMatch = text.match(/<StructuredOutput>\s*({[\s\S]*?})\s*<\/StructuredOutput>/);
  if (structuredMatch) {
    text = structuredMatch[1];
  } else {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      text = jsonMatch[0];
    }
  }

  try {
    const parsed = JSON.parse(text);
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
    console.warn('[wordpress-info] Failed to parse agent response:', err, 'Text:', text.slice(0, 200));
    return null;
  }
}

/** The payload's optional onProgress callback reports each step's status. */
async function onLessonStarted({ userId, lessonId, lesson, lessonKB, onProgress }, ctx) {
  const { ai, LLM } = ctx;
  // A recorder only on a traced call (and only on a host that has one).
  const trace = ctx.trace?.on ? ctx.trace : null;
  const reportProgress = (stepId, status) => {
    if (onProgress) onProgress('wordpress-info', stepId, status);
  };

  try {
    reportProgress('scan-keywords', 'in_progress');
    const plannerContext = `
**Exemplar:** ${lesson.exemplar || 'N/A'}

**Learning Objectives:**
${(lesson.learningObjectives || []).map(obj => `- ${obj}`).join('\n')}

${lesson.coachDirective ? `**Coach Directive:**\n${lesson.coachDirective}\n` : ''}
**WordPress Keywords:** ${KEYWORDS.join(', ')}

Analyze this lesson and decide whether to enrich it with WordPress documentation.
`;

    const plan = await callAgentWithSchema('wordpress-info-planner', plannerContext, PLANNER_SCHEMA, ai, LLM,
      'Planner: decide whether this lesson is about WordPress and what to search for');

    if (!plan || !plan.shouldEnrich || !plan.queries || !plan.queries.length) {
      trace?.note(!plan
        ? 'The planner’s reply couldn’t be read, so nothing was searched and no context was added.'
        : 'The planner decided this lesson doesn’t need WordPress reference material, so nothing was searched and no context was added.');
      reportProgress('scan-keywords', 'completed');
      reportProgress('build-queries', 'skipped');
      reportProgress('execute-queries', 'skipped');
      reportProgress('synthesize-context', 'skipped');
      return null;
    }

    reportProgress('scan-keywords', 'completed');
    reportProgress('build-queries', 'completed');

    reportProgress('execute-queries', 'in_progress');
    const queryResults = await executeQueries(plan.queries, SOURCES, trace);

    const totalResults = queryResults.reduce((sum, q) => sum + q.results.length, 0);
    trace?.note(`${plan.queries.length} search ${plan.queries.length === 1 ? 'query' : 'queries'} returned ${totalResults} result${totalResults === 1 ? '' : 's'}.`);
    if (totalResults === 0) {
      reportProgress('execute-queries', 'failed');
      reportProgress('synthesize-context', 'skipped');
      return null;
    }
    reportProgress('execute-queries', 'completed');

    reportProgress('synthesize-context', 'in_progress');
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

${lesson.coachDirective ? `**Coach Directive:**\n${lesson.coachDirective}\n` : ''}
**Query Results:**

${resultsText}

Synthesize a concise, lesson-specific context note (~300 words).
`;

    const synthesis = await callAgentWithSchema('wordpress-info-synthesizer', synthesizerContext, SYNTHESIZER_SCHEMA, ai, LLM,
      'Synthesiser: turn the search results into a short note for the coach');
    if (!synthesis || !synthesis.context) {
      trace?.note('The synthesiser’s reply couldn’t be read, so no context was added.');
      reportProgress('synthesize-context', 'failed');
      return null;
    }
    reportProgress('synthesize-context', 'completed');

    // Collect sources for citation
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

    return {
      pluginId: 'wordpress-info',
      label: 'WordPress.org',
      context: synthesis.context,
      reasoning: synthesis.reasoning,
      sources: allSources.slice(0, 8),
    };
  } catch (err) {
    // Fail open — never block lesson start
    console.error('[wordpress-info] Enrichment failed:', err);
    trace?.note(`WordPress Info stopped with an error, so no context was added: ${err?.message || err}`);
    return null;
  }
}

export default {
  hooks: {
    lessonStarted: onLessonStarted,
  },
};
