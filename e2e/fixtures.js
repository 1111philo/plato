export const ADMIN = { email: 'admin@plato.dev', password: 'admin123' };
export const LEARNER = { email: 'learner@example.com', password: 'password123', name: 'Lee Learner' };
export const EDUCATOR = { email: 'educator@example.com', password: 'password123', name: 'Eda Educator', role: 'educator' };
export const TESTER = { email: 'tester@example.com', password: 'password123', name: 'Tess Tester', role: 'tester' };
// Hierarchy (#408): a Course (stored program:*) containing a Unit (stored course:*).
export const PROGRAM = { id: 'prog-e2e0001', name: 'Launch Course' };
export const COURSE = { id: 'course-e2e0001', name: 'Getting Ready' }; // a unit

const md = (name) => `# ${name}

A short lesson for the e2e suite.

## Exemplar

A short written example.

## Learning Objectives

- Can name the key idea
- Can apply it to an example`;

const longMd = (name) => `# ${name}

A lesson whose overview is long enough to overflow its dialog.

## Exemplar

${Array.from({ length: 40 }, (_, i) => `Exemplar paragraph ${i + 1}: a detailed description of what excellent work looks like.`).join('\n\n')}

## Learning Objectives

- Can name the key idea
- Can apply it to an example
- Can explain why it matters
- Can teach it to someone else`;

export const LESSONS = [
  { id: 'e2e-lesson-1', name: 'Lesson One', markdown: md('Lesson One') },
  { id: 'e2e-lesson-2', name: 'Lesson Two', markdown: md('Lesson Two') },
  { id: 'e2e-lesson-long', name: 'Long Overview Lesson', markdown: longMd('Long Overview Lesson') },
];
