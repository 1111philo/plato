/**
 * Hello World Context plugin — minimal enrichment example.
 *
 * Demonstrates the lessonEnrichment pattern: a plugin with hook.lessonStarted
 * + lessonEnrichment capability can return context data that appears in the
 * lesson overview's "Additional Context" section and is injected into the
 * coach's system prompt.
 */

/**
 * lessonStarted hook handler.
 * Always returns enrichment data (unlike WordPress Info which checks keywords).
 */
async function onLessonStarted({ userId, lessonId, lesson, lessonKB }) {
  // This plugin enriches EVERY lesson with a simple message
  return {
    pluginId: 'hello-world-context',
    label: 'Hello World Plugin',
    context: 'This is example context added by a plugin! Any plugin with the lessonEnrichment capability can add reference material that appears in the lesson overview and is available to the coach.',
    reasoning: 'This demonstrates that any plugin can enrich lessons, not just WordPress Info.',
    sources: [
      {
        url: 'https://github.com/1111philo/plato',
        title: 'plato on GitHub',
        excerpt: 'Example source link - plugins can cite documentation or resources'
      }
    ],
  };
}

export default {
  hooks: {
    lessonStarted: onLessonStarted,
  },
};
