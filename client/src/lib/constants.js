// Microlearning constraints — single source of truth for course limits.
// Prompts (client/prompts/*.md) reference these values as literal numbers;
// update them there too if you change these.
export const MAX_EXCHANGES = 11;
export const MIN_OBJECTIVES = 2;
export const MAX_OBJECTIVES = 4;

export const VIEW_DEPTH = {
  '/onboarding': 0,
  '/courses': 1,
  '/courses/create': 2,
  '/course': 2,
  '/settings': 1,
};

export const COURSE_PHASES = {
  COURSE_INTRO: 'course_intro',
  LEARNING: 'learning',
  COMPLETED: 'completed',
};

export const MSG_TYPES = {
  GUIDE: 'guide',
  USER: 'user',
};
