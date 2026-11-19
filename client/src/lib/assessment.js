/**
 * Grading check (#584). The coach teaches and grades in the same reply, and
 * on its own it credited work it wrote itself ("Try this revision: …" →
 * learner: "That is me" → "You've nailed the exemplar"), and completed
 * lessons on one-line answers. The prompt already forbade both; prose in a
 * long prompt isn't enough.
 *
 * So on a turn where the coach checks off a new objective or says the lesson
 * is complete, a second agent (prompts/assessor.md) decides each objective
 * from the learner's own messages and must quote them. This module is the
 * pure part: what to check, the assessor's input, and the grounding check
 * that throws out any "shown" the learner's words don't back up. Nothing here
 * decides completion — applyCoachResponseToKB does (it needs every objective
 * checked off). Unit tests: client/tests/assessment.test.js.
 */

const MAX_PROGRESS = 10;
/** The highest score a turn can keep when its completion was held back. */
export const HELD_PROGRESS = 8;
const MAX_TRANSCRIPT = 40;
const LINK_CONTEXT_PREFIX = '[REFERENCE CONTEXT';

/** 1-based numbers of the objectives the coach claimed this turn that weren't already checked off. */
function claimedNew(kb, parsed) {
  const n = kb?.objectives?.length || 0;
  const met = new Set(kb?.objectivesMet || []);
  const out = new Set();
  for (const v of parsed?.kbUpdate?.objectivesMet || []) {
    const i = Number(v) - 1;
    if (Number.isInteger(i) && i >= 0 && i < n && !met.has(i)) out.add(i + 1);
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * What to check this turn. `completionClaimed` when the reply scores 10; then
 * every objective not yet checked off is checked (the coach often doesn't
 * list them all on the turn it finishes). Nothing on a completed lesson or a
 * lesson without objectives.
 */
export function assessmentPlan(kb, parsed) {
  const n = kb?.objectives?.length || 0;
  if (!n || kb?.status === 'completed') return { check: [], claimed: [], completionClaimed: false };
  const claimed = claimedNew(kb, parsed);
  const completionClaimed = Number(parsed?.progress) >= MAX_PROGRESS;
  const met = new Set(kb.objectivesMet || []);
  const check = completionClaimed
    ? Array.from({ length: n }, (_, i) => i).filter((i) => !met.has(i)).map((i) => i + 1)
    : claimed;
  return { check, claimed, completionClaimed };
}

/** A message's text as the assessor should read it: no link page text, images as a marker. */
function messageText(content, role) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const out = [];
  for (const part of content) {
    if (part?.type === 'text' && typeof part.text === 'string') {
      // A link's page text is reference material, not the learner's words.
      if (role === 'user' && part.text.startsWith(LINK_CONTEXT_PREFIX)) out.push('[attached a web page]');
      else out.push(part.text);
    } else if (part?.type === 'image') out.push('[image]');
  }
  return out.join('\n');
}

/**
 * The conversation as `[{ by, text }]`, oldest first, from coach-call
 * messages (`[{ role, content }]`). The context message and its "Ready." are
 * dropped: they're plato's, not the conversation.
 */
export function assessmentTranscript(messages) {
  const convo = (messages || []).slice(2).slice(-MAX_TRANSCRIPT);
  return convo
    .map((m) => ({ by: m.role === 'user' ? 'learner' : 'coach', text: messageText(m.content, m.role).trim() }))
    .filter((m) => m.text);
}

/** The assessor's user message. Only the objectives' wording and evidence: no notes, no scores. */
export function assessmentInput({ lesson, kb, transcript, check, imageThisTurn = false }) {
  const objectives = (kb?.objectives || []).map((o, i) => {
    const item = typeof o === 'string' ? { objective: o } : o;
    return { n: i + 1, objective: item.objective, ...(item.evidence ? { evidence: item.evidence } : {}) };
  });
  return JSON.stringify({ exemplar: lesson?.exemplar || '', objectives, check, transcript, imageThisTurn });
}

/** The assessor's JSON, tolerating code fences or a sentence around it. Throws when there's none. */
export function parseVerdict(raw) {
  const text = String(raw ?? '').replace(/```(?:json)?/g, '').trim();
  try { return JSON.parse(text); } catch { /* look for the object */ }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) return JSON.parse(text.slice(start, end + 1));
  throw new Error('assessor reply had no JSON');
}

/** Lowercase, straight quotes, letters/digits/spaces only, single spaces. */
export function normalizeForMatch(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const words = (s) => normalizeForMatch(s).split(' ').filter(Boolean);

/** True when `quote` appears in `text`: as a substring, or ≥80% of its words in order (the model sometimes drops a word). */
function appearsIn(quote, text) {
  const q = normalizeForMatch(quote);
  const t = normalizeForMatch(text);
  if (!q || !t) return false;
  if (t.includes(q)) return true;
  const qw = words(quote);
  if (qw.length < 4) return false;
  const tw = words(text);
  let j = 0, hits = 0;
  for (const w of qw) {
    const k = tw.indexOf(w, j);
    if (k !== -1) { hits++; j = k + 1; }
  }
  return hits / qw.length >= 0.8;
}

/**
 * Keep an assessor "shown" only when its quote is really the learner's:
 * found in a learner message, and not text the coach wrote that the learner
 * pasted back (5+ words also found in a coach message). "[image]" counts only
 * when this turn has an image. Returns `{ shown, missing }`: 1-based numbers
 * shown, and `{ n: why }` for the rest of `check`.
 */
export function groundVerdict(verdict, transcript, check, { imageThisTurn = false } = {}) {
  const learner = transcript.filter((m) => m.by === 'learner').map((m) => m.text);
  const coach = transcript.filter((m) => m.by === 'coach').map((m) => m.text);
  const byN = new Map();
  for (const o of Array.isArray(verdict?.objectives) ? verdict.objectives : []) {
    const n = Number(o?.n);
    if (Number.isInteger(n)) byN.set(n, o);
  }
  const shown = [];
  const missing = {};
  for (const n of check) {
    const o = byN.get(n);
    const quote = typeof o?.quote === 'string' ? o.quote.trim() : '';
    if (o?.shown !== true || !quote) {
      missing[n] = (typeof o?.missing === 'string' && o.missing.trim()) || 'not yet shown in the learner’s own words';
      continue;
    }
    if (quote === '[image]') {
      if (imageThisTurn) shown.push(n);
      else missing[n] = 'not yet shown in the learner’s own words';
      continue;
    }
    const theirs = learner.some((t) => appearsIn(quote, t));
    const coachWrote = words(quote).length >= 5 && coach.some((t) => appearsIn(quote, t));
    if (theirs && !coachWrote) shown.push(n);
    else missing[n] = coachWrote ? 'the words that would show it were written by the coach' : 'not yet shown in the learner’s own words';
  }
  return { shown, missing };
}

/**
 * Apply a grounded verdict to the parsed coach reply. Objectives the coach
 * claimed but the check didn't back up are taken out of `objectivesMet`;
 * objectives the check found shown (including ones the coach didn't list on
 * a completing turn) are added. When the reply scored 10 but some objective
 * still isn't shown, completion is held: the score is capped at
 * HELD_PROGRESS. Returns `{ parsed, held, unverified, outstanding }`.
 */
export function applyVerdict(parsed, kb, plan, grounded) {
  const n = kb?.objectives?.length || 0;
  const met = new Set((kb?.objectivesMet || []).map((i) => i + 1));
  const shown = new Set(grounded.shown);
  const reported = (parsed?.kbUpdate?.objectivesMet || []).map(Number).filter((v) => Number.isInteger(v) && v >= 1 && v <= n);
  const keep = new Set([...reported.filter((v) => met.has(v) || shown.has(v)), ...shown]);
  const unverified = plan.claimed.filter((v) => !shown.has(v));
  const allMet = new Set([...met, ...keep]);
  const outstanding = Array.from({ length: n }, (_, i) => i + 1).filter((v) => !allMet.has(v));
  const held = plan.completionClaimed && outstanding.length > 0;
  const kbUpdate = parsed?.kbUpdate || (keep.size ? {} : null);
  const next = {
    ...parsed,
    kbUpdate: kbUpdate ? { ...kbUpdate, objectivesMet: [...keep].sort((a, b) => a - b) } : kbUpdate,
  };
  if (held) next.progress = Math.min(Number(parsed.progress) || 0, HELD_PROGRESS);
  return { parsed: next, held, unverified, outstanding };
}

/** The coach's second try when completion was held: what's still missing, from plato. */
export function heldCompletionAddendum(kb, outstanding, missing) {
  const lines = outstanding.map((n) => {
    const o = kb.objectives[n - 1];
    const text = typeof o === 'string' ? o : o?.objective;
    return `- Objective ${n}, "${text}": ${missing[n] || 'not yet shown in the learner’s own words'}`;
  });
  return `## Assessment check (from plato, not the learner)

You were about to tell the learner this lesson is complete. A check of the learner's own messages found these objectives not shown yet:
${lines.join('\n')}

Write your reply to the learner's last message again, in your usual voice and length:
- Say specifically what their own words did show.
- Don't say the lesson, the exemplar, or the objectives above are done.
- Ask for ONE next thing toward the first objective above, in their own words. Don't write it for them, not even as an example to approve.
- End with your tags. [PROGRESS] is ${HELD_PROGRESS} or lower, and objectivesMet lists only objectives their own words showed.`;
}

/** Every objective checked off, or the lesson has none. Used by applyCoachResponseToKB to allow completion. */
export function allObjectivesMet(kb) {
  const n = kb?.objectives?.length || 0;
  if (!n) return true;
  const met = new Set(kb.objectivesMet || []);
  for (let i = 0; i < n; i++) if (!met.has(i)) return false;
  return true;
}
