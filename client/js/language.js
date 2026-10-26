// Learner language for AI agent output (#240). The learner's browser language
// (navigator.language) decides what language every agent writes in. Pure
// functions so they're unit-tested (client/tests/language.test.js) and the
// Bedrock harness can exercise the exact directive text.
//
// English — or any language not in the map — adds NOTHING to the prompt, so
// English learners' prompts stay byte-for-byte what they were.

const LANGUAGE_NAMES = {
  es: 'Spanish', fr: 'French', de: 'German', it: 'Italian', pt: 'Portuguese',
  zh: 'Chinese', ja: 'Japanese', ko: 'Korean', ar: 'Arabic', hi: 'Hindi',
  ru: 'Russian', nl: 'Dutch', pl: 'Polish', tr: 'Turkish', sv: 'Swedish',
  da: 'Danish', fi: 'Finnish', nb: 'Norwegian', no: 'Norwegian', vi: 'Vietnamese',
  uk: 'Ukrainian', tl: 'Tagalog', fil: 'Filipino', id: 'Indonesian', he: 'Hebrew',
};

/**
 * The learner's non-English language name (e.g. 'Spanish'), or null for
 * English, an unmapped language, or no navigator (Node/SSR).
 */
export function learnerLanguageName(nav = globalThis.navigator) {
  const code = (nav?.languages?.[0] || nav?.language || '').toLowerCase();
  const base = code.split('-')[0];
  return LANGUAGE_NAMES[base] || null;
}

/**
 * The system-prompt section telling an agent which language to write in.
 * plato's code parses several literals out of agent output — the bracketed
 * tags, JSON keys/values, lesson markdown headings, and the `- Can `
 * objective prefix (server/src/routes/admin.js validateLessonMarkdown) — so
 * the directive names them explicitly as things NOT to translate.
 */
export function languageDirective(languageName) {
  if (!languageName) return '';
  return `\n\n---\n\n## Language

The learner reads ${languageName}. Write everything a person will read in ${languageName}: your messages, questions, and feedback, and the human-readable text inside your output (insights, observations, summaries, profile and progress notes, lesson and knowledge-base prose).

Keep these exactly as they appear in this prompt, in English, because plato's code reads them:
- Bracketed tags, such as [PROGRESS: N], [KB_UPDATE: {...}], [PROFILE_UPDATE: {...}], [READINESS: N], [DRAFT].
- JSON keys and fixed JSON values, such as "status": "completed".
- Markdown section headings, such as ## Learning Objectives, ## Exemplar, and ## Coach Directive.
- The "- Can " at the start of each learning objective (write the rest of the objective in ${languageName}).`;
}

/** Append the learner's language directive (if any) to a system prompt. */
export function withLanguage(systemPrompt, nav) {
  return systemPrompt + languageDirective(learnerLanguageName(nav));
}
