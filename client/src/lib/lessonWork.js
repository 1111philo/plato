// The lesson work view (#438): objectives checklist, summary, and the
// learner's saved attachments, read from what plato already stores. Pure,
// tested in client/tests/lessonWork.test.js.

/**
 * Fold the coach's optional `objectivesMet` (1-based numbers, as the
 * objectives are listed in its context) into the lesson KB, one way only: a
 * met objective stays met. Stored 0-based in `lessonKB.objectivesMet`.
 * Informational; completion is still decided by applyCoachResponseToKB from
 * the progress score. A completed lesson isn't changed (every objective
 * counts as met there).
 */
export function mergeObjectivesMet(kb, kbUpdate) {
  const reported = kbUpdate?.objectivesMet;
  if (!kb || kb.status === 'completed' || !Array.isArray(reported)) return kb;
  const n = kb.objectives?.length || 0;
  const met = new Set(Array.isArray(kb.objectivesMet) ? kb.objectivesMet : []);
  const before = met.size;
  for (const v of reported) {
    const i = Number(v) - 1;
    if (Number.isInteger(i) && i >= 0 && i < n) met.add(i);
  }
  if (met.size === before) return kb;
  return { ...kb, objectivesMet: [...met].sort((a, b) => a - b) };
}

/** `[{ objective, met }]` for the checklist. Every objective is met once the lesson is complete. */
export function objectiveStatuses(kb, fallbackObjectives = []) {
  const list = kb?.objectives?.length
    ? kb.objectives.map((o) => (typeof o === 'string' ? o : o.objective))
    : fallbackObjectives;
  const done = kb?.status === 'completed';
  const met = new Set(kb?.objectivesMet || []);
  return list.map((objective, i) => ({ objective, met: done || met.has(i) }));
}

/** 1-based numbers for the coach's context, or undefined when none are met. */
export function objectivesMetForContext(kb) {
  const met = kb?.objectivesMet;
  return Array.isArray(met) && met.length ? met.map((i) => i + 1) : undefined;
}

/**
 * The learner's attachments in this lesson, oldest first:
 * `{ kind: 'image', key?, dataUrl?, at }` and `{ kind: 'link', url, title, at }`.
 * Images are referenced by `metadata.imageKeys` (fetched on demand); messages
 * hydrated this session also carry `imageDataUrls`.
 */
export function collectArtifacts(messages) {
  const out = [];
  for (const m of messages || []) {
    if (m.role !== 'user' || !m.metadata) continue;
    const at = m.timestamp || null;
    const keys = Array.isArray(m.metadata.imageKeys) ? m.metadata.imageKeys : [];
    const urls = Array.isArray(m.metadata.imageDataUrls) ? m.metadata.imageDataUrls : [];
    const count = Math.max(keys.length, urls.length);
    for (let i = 0; i < count; i++) out.push({ kind: 'image', key: keys[i] || null, dataUrl: urls[i] || null, at });
    for (const l of Array.isArray(m.metadata.links) ? m.metadata.links : []) {
      if (l?.url) out.push({ kind: 'link', url: l.url, title: l.title || l.url, at });
    }
  }
  return out;
}
