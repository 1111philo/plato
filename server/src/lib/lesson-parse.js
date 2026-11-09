/**
 * Lesson markdown → the fields the classroom uses: `{ name, description,
 * exemplar, learningObjectives, coachDirective? }`.
 *
 * A line-for-line copy of the client's `parseLessonPrompt`
 * (client/js/lessonOwner.js), so `GET /v1/lessons` can send these fields
 * instead of every lesson's full markdown (#451 scale review, B1). Keep the
 * two identical: client/tests/lessonParse.test.js runs both on the same
 * inputs, including every bundled lesson.
 */
export function parseLessonFields(markdown) {
  const lines = markdown.split('\n');
  let name = '';
  let description = '';
  let exemplar = '';
  let coachDirective = '';
  const objectives = [];
  let currentSection = null;
  const sectionBuffer = [];

  const flushSection = () => {
    if (currentSection === 'exemplar') exemplar = sectionBuffer.join('\n').trim();
    if (currentSection === 'coach_directive') coachDirective = sectionBuffer.join('\n').trim();
  };

  for (const line of lines) {
    if (line.startsWith('# ') && !name) {
      name = line.slice(2).trim();
      continue;
    }

    if (line.startsWith('## ')) {
      flushSection();
      sectionBuffer.length = 0;
      currentSection = line.slice(3).trim().toLowerCase().replace(/\s+/g, '_');
      continue;
    }

    if (currentSection === null && line.trim() && name && !description) {
      description = line.trim();
      continue;
    }

    if (currentSection === 'exemplar' || currentSection === 'coach_directive') {
      sectionBuffer.push(line);
    }

    if (currentSection === 'learning_objectives') {
      const match = line.match(/^-\s+(.+)/);
      if (match) objectives.push(match[1].trim());
    }
  }

  flushSection();

  const parsed = { name, description, exemplar, learningObjectives: objectives };
  if (coachDirective) parsed.coachDirective = coachDirective;
  return parsed;
}
