// "Behind this response" (#411): which of plato's agents worked on a reply,
// what each read, and what it did. Built from what plato already parses out
// of agent output (progress, KB notes, profile observations, readiness), so
// it reports real effects, never the model's raw reasoning. Stored on the
// assistant message as `metadata.agents` and rendered by
// components/chat/AgentActivity.jsx. Unit tests: client/tests/agentActivity.test.js.

export const AGENT_LABELS = Object.freeze({
  coach: 'Coach',
  'lesson-owner': 'Lesson planner',
  'learner-profile-update': 'Learner profile',
  'course-progress-update': 'Unit progress',
  'lesson-creator': 'Lesson creator',
  'knowledge-base-editor': 'Knowledge base editor',
  plugins: 'Plugins',
});

const MAX_TEXT = 280;
const MAX_NOTES = 5;

const clip = (s) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > MAX_TEXT ? `${t.slice(0, MAX_TEXT - 1)}…` : t;
};
const list = (arr) => (arr || []).map(clip).filter(Boolean);

/** One entry: `{ agent, label, read?, did?, notes? }`, empty lists dropped. */
export function entry(agent, { read, did, notes } = {}) {
  const e = { agent, label: AGENT_LABELS[agent] || agent };
  const r = list(read);
  const d = list(did);
  const n = list(notes).slice(0, MAX_NOTES);
  if (r.length) e.read = r;
  if (d.length) e.did = d;
  if (n.length) e.notes = n;
  return e;
}

/** What the authoring agents read on every turn (orchestrator.js appends the KB and catalog). */
export const AUTHORING_READS = ['Your conversation so far', 'The program knowledge base', 'The lesson catalog'];

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function coachReads({ hasUnitNote, images = 0, links = 0 }) {
  return [
    'This lesson and its objectives',
    'Your progress so far',
    'Your learner profile',
    'The program knowledge base and lesson catalog',
    ...(hasUnitNote ? ['What you did in other lessons of this unit'] : []),
    ...(images ? [`${plural(images, 'image')} you attached`] : []),
    ...(links ? [`${plural(links, 'linked page')}`] : []),
  ];
}

function progressLine(before, after, { achieved, wasCompleted }) {
  if (wasCompleted) return 'Gave feedback (the lesson was already complete)';
  if (achieved) return 'Marked the lesson complete';
  if (typeof after !== 'number') return null;
  if (typeof before === 'number' && after !== before) return `Progress ${before} → ${after} of 10`;
  return `Progress ${after} of 10`;
}

/**
 * A coach turn in a lesson. `before` / `after` are the lesson KB on either
 * side of applyCoachResponseToKB; `parsed` is parseCoachResponse's output.
 */
export function coachTurnActivity({ before, after, parsed, achieved = false, newlyMet = [], images = 0, links = 0, hasUnitNote = false, unitName = null }) {
  const wasCompleted = before?.status === 'completed';
  const coach = entry('coach', {
    read: coachReads({ hasUnitNote, images, links }),
    did: [
      progressLine(before?.progress, after?.progress, { achieved, wasCompleted }),
      ...newlyMet.map((o) => `Checked off an objective: ${o}`),
    ],
    notes: [
      ...(parsed?.kbUpdate?.insights || []),
      ...(parsed?.kbUpdate?.learnerPosition ? [`Where you are: ${parsed.kbUpdate.learnerPosition}`] : []),
    ],
  });
  const out = [coach];
  // Mirrors sendMessage: an explicit observation, else the KB insights.
  const observation = parsed?.profileUpdate?.observation
    || (parsed?.kbUpdate?.insights?.length ? parsed.kbUpdate.insights.join('. ') : null);
  if (observation) {
    out.push(entry('learner-profile-update', { did: ['Asked to update your learner profile from this turn'], notes: [observation] }));
  }
  if (achieved) {
    out.push(entry('learner-profile-update', { did: ['Asked to add this completed lesson to your learner profile'] }));
    if (unitName) out.push(entry('course-progress-update', { did: [`Asked to update your progress note for ${unitName}`] }));
  }
  return out;
}

/** The opening message of a lesson: the lesson planner, plugins, then the coach. */
export function lessonStartActivity({ lessonKB, enrichments = [], hasUnitNote = false }) {
  const objectives = lessonKB?.objectives?.length || 0;
  const out = [entry('lesson-owner', {
    read: ['This lesson and its objectives', 'Your learner profile'],
    did: [objectives ? `Planned how you'll show ${plural(objectives, 'objective')}` : 'Planned the lesson'],
    notes: lessonKB?.learnerPosition ? [`Where you are: ${lessonKB.learnerPosition}`] : [],
  })];
  if (enrichments.length) {
    out.push(entry('plugins', { did: [`Added reference material: ${enrichments.map((e) => e.label || e.pluginId).join(', ')}`] }));
  }
  out.push(entry('coach', { read: coachReads({ hasUnitNote }), did: ['Opened the lesson'] }));
  return out;
}

/** An admin authoring turn (lesson creator, knowledge base editor). */
export function authoringActivity(agent, { before, after, reads }) {
  let did = null;
  if (typeof after === 'number') {
    did = typeof before === 'number' && before !== after ? `Readiness ${before} → ${after} of 10` : `Readiness ${after} of 10`;
  }
  return [entry(agent, { read: reads, did: [did] })];
}

/** "Coach, Learner profile": distinct labels, in order. */
export function activitySummary(agents) {
  return [...new Set((agents || []).map((a) => a.label))].join(', ');
}
