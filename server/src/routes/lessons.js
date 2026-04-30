import { Hono } from 'hono';
import db from '../lib/db.js';
import { authenticate } from '../middleware/authenticate.js';

const lessons = new Hono();

lessons.use('/v1/lessons*', authenticate);

/**
 * Compute per-lesson time stats from completed lesson KB records.
 * Returns { [lessonId]: { p20, p80, sampleSize } } where p20/p80 are
 * exchange counts at the 20th and 80th percentile (middle 60% range).
 */
async function computeLessonTimeStats(lessonIds) {
  const result = {};

  await Promise.all(
    lessonIds.map(async (lessonId) => {
      try {
        // Fetch all completed KB records for this lesson across all users
        const completions = await db.getCompletedLessonKBs(lessonId);
        if (!completions || completions.length < 3) return; // need minimum sample

        // Extract activitiesCompleted (exchange count at completion)
        const counts = completions
          .map(kb => kb.activitiesCompleted)
          .filter(n => typeof n === 'number' && n > 0)
          .sort((a, b) => a - b);

        if (counts.length < 3) return;

        const p20Idx = Math.floor(counts.length * 0.2);
        const p80Idx = Math.min(Math.floor(counts.length * 0.8), counts.length - 1);

        result[lessonId] = {
          p20: counts[p20Idx],
          p80: counts[p80Idx],
          sampleSize: counts.length,
        };
      } catch { /* skip this lesson */ }
    })
  );

  return result;
}

// GET /v1/lessons — list public lessons the user can access
lessons.get('/v1/lessons', async (c) => {
  const user = c.get('user');
  const allLessons = await db.listLessons();

  const visible = allLessons.filter(l => {
    if (l.status === 'draft' && !l.markdown) return false;
    const effective = (l.status === 'published' || l.status === 'public') ? 'public'
      : (l.status === 'draft' && !l.markdown) ? 'draft'
      : 'private';
    if (effective === 'public') return true;
    if (effective === 'private') {
      return Array.isArray(l.sharedWith) && l.sharedWith.includes(user.userId);
    }
    return false;
  });

  return c.json(visible.map(l => ({
    lessonId: l.lessonId,
    name: l.name,
    description: l.description,
    status: l.status,
  })));
});

// GET /v1/lessons/time-stats — per-lesson completion time estimates (middle 60% range)
// Returns { [lessonId]: { p20, p80, sampleSize } } for lessons with >=3 completions.
// Used to display estimated time tags on lesson cards.
lessons.get('/v1/lessons/time-stats', async (c) => {
  const user = c.get('user');

  // Only show stats for lessons the user can see
  const allLessons = await db.listLessons();
  const visible = allLessons.filter(l => {
    if (l.status === 'draft' && !l.markdown) return false;
    const effective = (l.status === 'published' || l.status === 'public') ? 'public'
      : (l.status === 'draft' && !l.markdown) ? 'draft'
      : 'private';
    if (effective === 'public') return true;
      if (effective === 'private') {
      return Array.isArray(l.sharedWith) && l.sharedWith.includes(user.userId);
    }
    return false;
  });

  const lessonIds = visible.map(l => l.lessonId);
  const stats = await computeLessonTimeStats(lessonIds);
  return c.json(stats);
});

export default lessons;
