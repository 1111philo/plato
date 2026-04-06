// Microlearning constraints — single source of truth for lesson limits.
// Prompts (client/prompts/*.md) reference these values as literal numbers;
// update them there too if you change these.
export const MAX_EXCHANGES = 11;
export const MIN_OBJECTIVES = 2;
export const MAX_OBJECTIVES = 4;

export const VIEW_DEPTH = {
  '/onboarding': 0,
  '/lessons': 1,
  '/lessons/create': 2,
  '/lesson': 2,
  '/settings': 1,
};

export const LESSON_PHASES = {
  LESSON_INTRO: 'lesson_intro',
  LEARNING: 'learning',
  COMPLETED: 'completed',
};

export const MSG_TYPES = {
  GUIDE: 'guide',
  USER: 'user',
};
