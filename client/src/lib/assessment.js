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
/** Words a quote needs before matching a coach message means the learner copied it. */
const COPY_WORDS = 8;

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

/**
 * The assessor's user message: the objectives' wording only. No notes or
 * scores, and not the lesson planner's per-learner `evidence` text either:
 * on prod the assessor applied its examples ("YYYY-MM-DD", "label it on
 * track") as requirements and held learners who met the objective (#584).
 */
export function assessmentInput({ lesson, kb, transcript, check, imageThisTurn = false, recheck = null, note = null }) {
  const objectives = (kb?.objectives || []).map((o, i) => ({ n: i + 1, objective: typeof o === 'string' ? o : o?.objective }));
  return JSON.stringify({ exemplar: lesson?.exemplar || '', objectives, check, transcript, imageThisTurn, ...(recheck ? { recheck } : {}), ...(note ? { note } : {}) });
}

/**
 * Repair the JSON mistake the model actually makes: copying a learner's curly
 * closing quote (”) as the end of a string, so the string never closes
 * (playground, 2026-11-21: a lesson completed because of it). A ” that ends a
 * value, just before a comma, brace, bracket, or line break, becomes a
 * straight quote.
 */
export function repairVerdictJson(text) {
  return String(text).replace(/[”“](\s*(?:,|\}|\]|\n))/g, '"$1');
}

/** The assessor's JSON, tolerating code fences, a sentence around it, or a curly closing quote. Throws when there's none. */
export function parseVerdict(raw) {
  const text = String(raw ?? '').replace(/```(?:json)?/g, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  const body = start !== -1 && end > start ? text.slice(start, end + 1) : text;
  for (const candidate of [text, body, repairVerdictJson(body)]) {
    try { return JSON.parse(candidate); } catch { /* next */ }
  }
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
 * found in a learner message, and not text the coach wrote first that the
 * learner pasted back (8+ words in a coach message *earlier* than the
 * learner's). The order matters: coaches quote learners' words back to them,
 * and that echo doesn't make the words the coach's (measured on prod, #584).
 * "[image]" counts only when this turn has an image. Returns `{ shown,
 * missing, ungrounded }`: 1-based numbers shown, `{ n: why }` for the rest of
 * `check`, and the numbers the assessor called shown with a quote that failed
 * (checkGrading asks it once more about those).
 */
export function groundVerdict(verdict, transcript, check, { imageThisTurn = false } = {}) {
  const firstIndex = (by, quote) => transcript.findIndex((m) => m.by === by && appearsIn(quote, m.text));
  const byN = new Map();
  for (const o of Array.isArray(verdict?.objectives) ? verdict.objectives : []) {
    const n = Number(o?.n);
    if (Number.isInteger(n)) byN.set(n, o);
  }
  const shown = [];
  const missing = {};
  const ungrounded = [];
  for (const n of check) {
    const o = byN.get(n);
    // Each part of the objective needs its own quote (assessor.md "parts");
    // a reply without parts gives one quote for the whole objective.
    const parts = Array.isArray(o?.parts) && o.parts.length ? o.parts : [{ quote: o?.quote }];
    const quotes = parts.map((p) => (typeof p?.quote === 'string' ? p.quote.trim() : ''));
    const gap = parts.find((p, i) => !quotes[i]);
    if (o?.shown !== true || gap) {
      const why = (typeof o?.missing === 'string' && o.missing.trim()) || (gap?.part ? `show this in their own words: ${gap.part}` : '');
      missing[n] = why || 'not yet shown in the learner’s own words';
      continue;
    }
    const textQuotes = quotes.filter((q) => q !== '[image]');
    if (textQuotes.length < quotes.length && !imageThisTurn) {
      missing[n] = 'not yet shown in the learner’s own words';
      continue;
    }
    let failed = null;
    for (const quote of textQuotes) {
      const result = groundQuote(quote);
      if (result !== true) { failed = result; break; }
    }
    if (!failed) shown.push(n);
    else { missing[n] = failed; ungrounded.push(n); }
  }
  return { shown, missing, ungrounded };

  /** true, or why the quote isn't the learner's. */
  function groundQuote(quote) {
    // A quote with an ellipsis joins passages: each part must be the learner's.
    const parts = quote.split(/\.\.\.|…/).map((q) => q.trim()).filter((q) => words(q).length >= 3);
    const pieces = parts.length > 1 ? parts : [quote];
    // Each piece on its own: the learner wrote it, and (for a passage of 8+
    // words, so a short phrase the coach used in a question doesn't count)
    // the coach didn't write that same piece earlier.
    for (const q of pieces) {
      const learnerAt = firstIndex('learner', q);
      const coachAt = words(q).length >= COPY_WORDS ? firstIndex('coach', q) : -1;
      if (coachAt !== -1 && (learnerAt === -1 || coachAt < learnerAt)) return 'the words that would show it were written by the coach';
      if (learnerAt === -1) return 'not yet shown in the learner’s own words';
    }
    return true;
  }
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

/** Sent with the retry when the assessor's reply wasn't valid JSON (temperature 0 would repeat it otherwise). */
export const FORMAT_NOTE = 'Your last reply was not valid JSON. Reply with valid JSON only. Use straight double quotes (") around every string, and leave any quotation marks out of the quotes you copy.';

/** Every objective checked off, or the lesson has none. Used by applyCoachResponseToKB to allow completion. */
export function allObjectivesMet(kb) {
  const n = kb?.objectives?.length || 0;
  if (!n) return true;
  const met = new Set(kb.objectivesMet || []);
  for (let i = 0; i < n; i++) if (!met.has(i)) return false;
  return true;
}

// What the coach says matters as much as the tags (#584 playground testing):
// on a held turn the coach's second try still told learners "this one is
// complete", against the progress bar. These catch that in code.

const COMPLETION_CLAIM = [
  /\b(?:you(?:'|’)ve|you have|you(?:'|’)re|you are)\s+(?:(?:now|fully|officially|clearly|successfully|really)\s+){0,3}(?:met|achieved|demonstrated|nailed|completed|finished|done with|hit|reached)\b[^.!?\n]{0,40}\b(?:exemplar|all (?:the |three |four |your |of the )?objectives|every objective|this lesson|the lesson)\b/i,
  /\b(?:this|the) (?:lesson|one) is (?:now )?(?:complete|done|finished)\b/i,
  /\bthis is your exemplar\b/i,
  /\bexemplar (?:achieved|met|complete)\b/i,
  /\b(?:go ahead and )?(?:start|move on to|continue to) the next lesson\b/i,
  /\bmeets all (?:the )?(?:lesson )?objectives\b/i,
  /\b(?:has|have)\s+(?:now\s+|fully\s+)?(?:met|achieved|demonstrated|completed)\b[^.!?\n]{0,40}\b(?:exemplar|all (?:the |three |four )?objectives)\b/i,
  /\ball (?:the )?objectives (?:are )?(?:demonstrated|met|achieved|complete)\b/i,
];

// More of the coach's real "done" wordings, measured on prod completing
// replies (the first list caught 67%): wrap-up questions, "ready to move
// on", "well done" after a result, "progress … 10".
COMPLETION_CLAIM.push(
  /\b(?:now that )?you(?:'|’)ve (?:wrapped (?:this|it) up|finished (?:this|the) lesson|completed (?:this|the) (?:lesson|exemplar))\b/i,
  /\bprogress(?: is)?(?: now)?\s*[:=]?\s*10\b/i,
  /\blesson complete\b/i,
  /\b(?:we(?:'|’)re|you(?:'|’)re) (?:all )?(?:done|finished)\b/i,
  /\byou(?:'|’)re ready to (?:move (?:on|into)|start|begin) (?:the next|your next|portfolio|the portfolio)/i,
  /\bhow did (?:this|the) (?:lesson|course) feel\b/i,
  /\bbefore we wrap\b/i,
  /\bthat(?:'|’)s (?:the|your) exemplar\b/i,
  /\b(?:exactly|fully) the exemplar\b/i,
);

/** Plain text for matching: no markdown emphasis or blockquote markers, one space. */
const plainText = (text) => String(text ?? '').replace(/[*_`>#]+/g, '').replace(/\s+/g, ' ');

/** True when text tells the learner the lesson (or every objective) is done. */
export function claimsCompletion(text) {
  const t = plainText(text);
  return COMPLETION_CLAIM.some((re) => re.test(t));
}

/**
 * Words a passage the coach writes for the learner needs before it counts as
 * drafting their answer. 20, not 10 (Blake, 2026-11-22): on prod 10 would fire
 * on 29% of mid-lesson replies, 20 on 14%, and still covers 57% of the
 * passages learners actually copied.
 */
export const DRAFT_WORDS = 20;
const QUOTED = /["“]([^"”\n]{0,600})["”]|(?:^|[^*])\*([^*\n]{0,600})\*(?!\*)/g;
const DRAFT_LEAD = /\b(?:try (?:this|something like|saying)?\s*:|here(?:'|’)s (?:a|your|one) (?:draft|version|revision)|revised(?: version)?\s*:|you could (?:write|say)\s*:|for example\s*:)/i;

/**
 * True when a coach reply writes a sentence for the learner to adopt: a
 * quoted or italic passage of DRAFT_WORDS+ words, or one after a lead like
 * "Try this:" / "Here's a draft". Learners copied these back and were held
 * for it, so plato asks the coach to rewrite such replies as a question.
 */
export function draftsForLearner(text) {
  const t = String(text ?? '');
  for (const m of t.matchAll(QUOTED)) {
    const span = (m[1] ?? m[2] ?? '').trim();
    if (span.split(/\s+/).filter(Boolean).length >= DRAFT_WORDS) return true;
  }
  for (const line of t.split('\n')) {
    const lead = line.match(DRAFT_LEAD);
    if (lead && line.slice(lead.index + lead[0].length).trim().split(/\s+/).filter(Boolean).length >= DRAFT_WORDS) return true;
  }
  return false;
}

/** The coach's addendum when its reply wrote the learner's text for them. */
export const DRAFT_ADDENDUM = `## Let them write it (from plato, not the learner)

Your reply wrote a sentence or passage for the learner to use as their own answer. Learners copy these, and copied text doesn't count as their work. Write your reply again:
- Give specific feedback on what they wrote.
- Ask them to write the next piece themselves. You may suggest what it should cover in a few words (a short phrase, not a sentence they could copy).
- No quoted or italic sample sentences. Keep your usual voice, length, and tags.`;

/**
 * The reply plato shows when completion is held and the coach's own words
 * still say the lesson is done: plain, kind, and naming the first thing
 * still needed.
 */
export function heldReply(kb, outstanding, missing) {
  const names = outstanding.map((n) => {
    const o = kb.objectives?.[n - 1];
    return (typeof o === 'string' ? o : o?.objective || '').replace(/^Can\s+/i, '');
  }).filter(Boolean);
  const first = outstanding[0];
  const why = missing?.[first] && !/^not yet shown/.test(missing[first]) ? ` (${missing[first]})` : '';
  const list = names.length > 1 ? `\n\nStill to show in your own words:\n${names.map((x) => `- ${x}`).join('\n')}` : '';
  return `You're close, but this lesson isn't complete yet. The next step is yours to write: **${names[0] || 'the remaining objective'}**${why}. Put it in your own words, even a few plain sentences, and send it when you're ready.${list}`;
}

/** The learner-visible "Where you are" note on a held turn, when the coach's says the lesson is done. */
export function heldPosition(kb, outstanding) {
  const names = outstanding.map((n) => {
    const o = kb.objectives?.[n - 1];
    return (typeof o === 'string' ? o : o?.objective || '').replace(/^Can\s+/i, '');
  }).filter(Boolean);
  return `Close to the exemplar. Still to show in your own words: ${names.join('; ')}.`;
}
