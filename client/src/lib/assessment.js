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
export const MAX_TRANSCRIPT = 40;
const LINK_CONTEXT_PREFIX = '[REFERENCE CONTEXT';
/** Words a quote needs before matching a coach message means the learner copied it. */
export const COPY_WORDS = 8;
/** More than this share of a quote's three-word sequences written first by the coach: the quote is the coach's wording. */
export const COPIED_SHARE = 0.5;

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

/**
 * True when `quote` appears in `text`: as a substring, or ≥80% of its words in
 * order within a short stretch of `text` (the model sometimes drops or changes
 * a word). The stretch is at most the quote's length plus a few words: without
 * that limit, a learner's own short sentence "appeared" in any long coach
 * message that happened to use its common words in the same order, so the
 * check said the coach wrote it (playground, 2026-11-24).
 */
export function appearsIn(quote, text, { tight = false } = {}) {
  const q = normalizeForMatch(quote);
  const t = normalizeForMatch(text);
  if (!q || !t) return false;
  if (t.includes(q)) return true;
  const qw = words(quote);
  if (qw.length < 4) return false;
  const tw = words(text);
  const need = Math.ceil(qw.length * 0.8);
  if (!tight) {
    let j = 0, hits = 0;
    for (const w of qw) { const k = tw.indexOf(w, j); if (k !== -1) { hits++; j = k + 1; } }
    return hits >= need;
  }
  const span = qw.length + Math.max(2, Math.ceil(qw.length * 0.25));
  for (let s = 0; s < tw.length; s++) {
    if (!qw.includes(tw[s])) continue;
    let j = s, hits = 0;
    for (const w of qw) {
      const k = tw.indexOf(w, j);
      if (k !== -1 && k < s + span) { hits++; j = k + 1; }
    }
    if (hits >= need) return true;
  }
  return false;
}

/** Share of a coach-written passage's words that must be the learner's earlier words for it to count as their polished text. */
export const OWN_SHARE = 0.7;

/** Two words a spelling slip apart: an edit distance of 1, or 2 for longer words. */
export function closeSpelling(a, b) {
  if (a === b) return true;
  const max = Math.min(a.length, b.length) >= 7 ? 2 : 1;
  if (Math.abs(a.length - b.length) > max || a.length < 5 || b.length < 5) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > max) return false;
    prev = cur;
  }
  return prev[b.length] <= max;
}

/** groundVerdict's reason when the words that would show an objective were the coach's. */
export const COACH_WROTE = 'the words that would show it were written by the coach';

/** groundVerdict's reason when the only evidence is a web address the learner typed (never opened). */
export const ONLY_URL = 'a link the learner typed was never opened: they need to attach the page, or send a screenshot';
const BARE_URL = /^\s*<?https?:\/\/\S+>?\s*$/i;

/** groundVerdict's reason when the only quote agrees with the coach ("yes, that's me"). */
export const ONLY_AGREES = 'the learner only agreed with words the coach wrote';

// The words of a reply that only agrees or confirms ("Yes, that's accurate,
// that's me."). The assessor counted these as showing an objective even
// though assessor.md says agreeing isn't showing (agent evaluations A17:
// 6 of 6), so plato's code doesn't let a quote made only of them count.
const AGREEING = new Set(('yes yeah yep yup sure ok okay fine that thats this it its is was me i im am you '
  + 'accurate correct right true exactly perfect great good nice sounds looks love like works agree agreed '
  + 'all of the above totally absolutely definitely really so very much thanks thank go ahead post send use do '
  // Spanish, the language most learners use after English (C22: "Eso soy yo").
  + 'si eso esto soy yo es correcto exacto exactamente perfecto vale claro esta bien de acuerdo usalo usa publicalo publica me gusta asi todo genial gracias listo').split(' '));

/** True when a quote only agrees or confirms: every word is an agreeing word. Pure. */
export function onlyAgrees(quote) {
  const ws = String(quote || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f’']/g, '').match(/\p{L}+/gu) || [];
  return ws.length > 0 && ws.length <= 12 && ws.every((w) => AGREEING.has(w));
}

/**
 * The objectives a confirmation can show: where the objective or the exemplar
 * says the learner confirms something the coach built (assessor.md "Unless the
 * lesson says otherwise", e.g. "Can confirm a profile that is true to them").
 * A Set of 1-based numbers.
 */
export function confirmingCounts(kb) {
  const exemplar = /\bconfirm/i.test(kb?.exemplar || '');
  return new Set((kb?.objectives || []).map((o, i) => (exemplar || /\bconfirm/i.test(typeof o === 'string' ? o : o?.objective || '') ? i + 1 : 0)).filter(Boolean));
}

/**
 * An objective as a step addressed to the learner. Objectives are written
 * about the learner ("Can ... confirm their profile"); held replies speak to
 * them ("confirm your profile"), playground 2026-11-23.
 */
export function objectiveForLearner(o) {
  return (typeof o === 'string' ? o : o?.objective || '')
    .replace(/^Can\s+/i, '')
    .replace(/\btheirs\b/gi, 'yours').replace(/\btheir\b/gi, 'your')
    .replace(/\bthemselves\b/gi, 'yourself').replace(/\bthem\b/gi, 'you').replace(/\bthey\b/gi, 'you');
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
 *
 * A quote that only agrees with the coach (`onlyAgrees`) doesn't count, except
 * for the objectives in `confirms` (confirmingCounts: the lesson says the
 * learner's confirmation shows them).
 *
 * With `evidence` (Trace mode), also `evidence: { n: [{ quote, learnerAt,
 * coachAt, ok }] }`: for each quote piece, which transcript message it was
 * found in (−1: nowhere), so a person can see why a quote did or didn't count.
 */
export function groundVerdict(verdict, transcript, check, { imageThisTurn = false, evidence = false, confirms = new Set() } = {}) {
  const found = {};
  let current = null;
  // The learner's words: a loose match, since the assessor paraphrases quotes. The coach's: a tight one,
  // or a learner's own sentence "appears" in any long coach message with the same common words.
  const firstIndex = (by, quote) => transcript.findIndex((m) => m.by === by && appearsIn(quote, m.text, { tight: by === 'coach' }));
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
    current = n;
    // A quote that only agrees ("yes, that's me") shows nothing, unless the
    // lesson says confirming counts (`confirms`, from confirmingCounts).
    if (textQuotes.length && textQuotes.every(onlyAgrees) && !confirms.has(n)) failed = ONLY_AGREES;
    // A typed web address shows nothing: plato never opened it (C16). An
    // attached page is "[attached a web page]", and an image "[image]".
    else if (textQuotes.length && textQuotes.every((q) => BARE_URL.test(q)) && textQuotes.length === quotes.length) failed = ONLY_URL;
    for (const quote of failed ? [] : textQuotes) {
      const result = groundQuote(quote);
      if (result !== true) { failed = result; break; }
    }
    if (!failed) shown.push(n);
    else { missing[n] = failed; ungrounded.push(n); }
  }
  return { shown, missing, ungrounded, ...(evidence ? { evidence: found } : {}) };

  /**
   * The coach's polish of the learner's own words counts as theirs (Blake,
   * 2026-11-23): when most of the passage's words were already in the
   * learner's messages before the coach wrote it, the coach only cleaned
   * them up. A misspelled word still counts as theirs (learners who spell
   * differently, e.g. with dyslexia, aren't held for the coach's corrections).
   */
  function polishOfOwn(q, coachAt) {
    const mine = transcript.slice(0, coachAt).filter((m) => m.by === 'learner').flatMap((m) => words(m.text));
    const content = words(q).filter((w) => w.length > 3);
    if (!content.length || !mine.length) return false;
    const own = new Set(mine);
    const theirs = content.filter((w) => own.has(w) || mine.some((m) => closeSpelling(w, m)));
    return theirs.length / content.length >= OWN_SHARE;
  }

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
      const coachFirst = coachAt !== -1 && (learnerAt === -1 || coachAt < learnerAt) && !polishOfOwn(q, coachAt);
      if (evidence) (found[current] ||= []).push({ quote: q, learnerAt, coachAt, ok: !coachFirst && learnerAt !== -1 });
      if (coachFirst) return COACH_WROTE;
      if (learnerAt === -1) return 'not yet shown in the learner’s own words';
      if (assembledFromCoach(q)) return COACH_WROTE;
    }
    return true;
  }

  /**
   * A quote mostly made of the coach's wording: more than COPIED_SHARE of its
   * three-word sequences first appeared in a coach message (and not in
   * anything the learner wrote before it). Catches the coach's sentences
   * joined up, or sent back with a word or two swapped as the coach
   * suggested (agent evaluations W4), which the whole-quote check misses.
   * The coach polishing the learner's own words still counts as theirs:
   * those sequences were the learner's first.
   */
  function assembledFromCoach(q) {
    const ws = words(q);
    if (ws.length < COPY_WORDS) return false;
    const grams = ws.slice(2).map((_, i) => ws.slice(i, i + 3).join(' '));
    const said = transcript.map((m) => ({ by: m.by, text: ` ${words(m.text).join(' ')} ` }));
    let copied = 0;
    for (const g of grams) {
      const coachAt = said.findIndex((m) => m.by === 'coach' && m.text.includes(` ${g} `));
      if (coachAt === -1) continue;
      if (!said.slice(0, coachAt).some((m) => m.by === 'learner' && m.text.includes(` ${g} `))) copied++;
    }
    return copied / grams.length > COPIED_SHARE;
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
- 2-4 sentences and one question (one question mark).
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
/** A quoted sample this long in the learner's first person ("I…", "my…") counts as their answer written for them. */
export const VOICE_WORDS = 3;
const VOICE = /(?:^|[^\p{L}'’])(?:i|i['’]m|i['’]ll|i['’]ve|i['’]d|my|me|mine)(?![\p{L}])/iu;
const QUOTED = /["“]([^"”\n]{0,600})["”]|(?:^|[^*])\*([^*\n]{0,600})\*(?!\*)/g;
const DRAFT_LEAD = /\b(?:hint\s*:|try (?:this|something like|saying)?\s*:|here(?:'|’)s (?:a|your|one) (?:draft|version|revision)|revised(?: version)?\s*:|you could (?:write|say)\s*:|for example\s*:)/i;

/**
 * True when a coach reply writes a sentence for the learner to adopt: a
 * quoted or italic passage of DRAFT_WORDS+ words, or one after a lead like
 * "Try this:" / "Here's a draft". Learners copied these back and were held
 * for it, so plato asks the coach to rewrite such replies as a question.
 */
export function draftsForLearner(text, learnerTexts = null) {
  const t = String(text ?? '');
  const said = learnerTexts ? normalizeForMatch(learnerTexts.join('\n')) : null;
  for (const m of t.matchAll(QUOTED)) {
    const span = (m[1] ?? m[2] ?? '').trim();
    if (span.split(/\s+/).filter(Boolean).length >= DRAFT_WORDS) return true;
    // A short sample in the learner's own voice ("e.g., 'Tuesday 6–7 PM on my
    // MacBook Pro'") is their answer written for them: learners pasted these
    // back (Blake's trace, 2026-11-25). The learner's own words quoted back
    // aren't (`learnerTexts`); a third-person example ("a deadline you hit") isn't.
    if (said != null && VOICE.test(span) && span.split(/\s+/).filter(Boolean).length >= VOICE_WORDS && !said.includes(normalizeForMatch(span))) return true;
  }
  for (const line of t.split('\n')) {
    const lead = line.match(DRAFT_LEAD);
    if (lead && line.slice(lead.index + lead[0].length).trim().split(/\s+/).filter(Boolean).length >= DRAFT_WORDS) return true;
  }
  return false;
}

// Han, kana and Hangul: what Qwen3-VL slips into replies in other languages
// ("one moment —哪怕很小— where you felt proud", agent evaluations C59).
const CJK_SCRIPT = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/;
const CJK_LANGUAGES = new Set(['Chinese', 'Japanese', 'Korean']);
// Languages with a script of their own: a reply to these learners should be
// mostly in it. A Bengali learner got whole lessons in English (agent
// evaluations W8), with the language in both the prompt and the context.
const SCRIPTS = {
  Bengali: /[\u0980-\u09ff]/g, Hindi: /[\u0900-\u097f]/g, Marathi: /[\u0900-\u097f]/g, Nepali: /[\u0900-\u097f]/g,
  Arabic: /[\u0600-\u06ff]/g, Urdu: /[\u0600-\u06ff]/g, Persian: /[\u0600-\u06ff]/g, Hebrew: /[\u0590-\u05ff]/g,
  Russian: /[\u0400-\u04ff]/g, Ukrainian: /[\u0400-\u04ff]/g, Greek: /[\u0370-\u03ff]/g,
  Punjabi: /[\u0a00-\u0a7f]/g, Gujarati: /[\u0a80-\u0aff]/g, Tamil: /[\u0b80-\u0bff]/g, Telugu: /[\u0c00-\u0c7f]/g,
  Thai: /[\u0e00-\u0e7f]/g, Burmese: /[\u1000-\u109f]/g, Khmer: /[\u1780-\u17ff]/g, Amharic: /[\u1200-\u137f]/g,
};

/**
 * True when a reply isn't in the learner's script: characters from Chinese,
 * Japanese or Korean in another language's reply, or, for a language with a
 * script of its own, a reply mostly in another one. Pure.
 */
export function mixesScripts(text, languageName = null) {
  const t = String(text || '');
  if (!CJK_LANGUAGES.has(languageName) && CJK_SCRIPT.test(t)) return true;
  const own = SCRIPTS[languageName];
  if (!own) return false;
  const letters = (t.replace(/\[[^\]]*\]/g, '').match(/\p{L}/gu) || []).length;
  return letters > 20 && (t.match(own) || []).length < letters * 0.5;
}

/** The coach's addendum when its reply mixed in another language. */
export const SCRIPT_ADDENDUM = `## One language (from plato, not the learner)

Your reply wasn't all in the learner's language: it was in another one, or mixed in words or characters from another. Write the same reply again, entirely in the learner's language (English, unless the context gives \`learnerLanguage\`). Keep your usual voice, length, and tags.`;

// Links and codes in an author's coach directive, which the coach must pass
// on exactly. It sometimes doesn't: "https:// comunidad.example.org/join" for
// https://community.example.org/join (agent evaluations H1).
const URL_IN = /https?:\/\/[^\s<>()[\]"'“”‘’]+/gi;
const CODE_IN = /\b[A-Z][A-Z0-9]*(?:[-_][A-Z0-9]+)+\b/g;
const trimUrl = (u) => u.replace(/[.,;:!?*_]+$/, '');
function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
const pathOf = (u) => { try { return new URL(u).pathname.replace(/\/$/, ''); } catch { return null; } };

/**
 * The reply with the directive's links and codes restored where it wrote a
 * near-miss: a link with the same path a few characters off (or a space
 * after "https://"), a code with a space or dash changed. A different link
 * (another path) is left alone. Pure.
 */
export function withDirectiveLiterals(text, directive) {
  if (!text || !directive) return text;
  const urls = [...new Set((String(directive).match(URL_IN) || []).map(trimUrl))];
  const codes = [...new Set(String(directive).match(CODE_IN) || [])].filter((c) => /\d/.test(c) && /[A-Z]/.test(c));
  let out = String(text);
  if (urls.length) {
    out = out.replace(/https?:\/\/\s+(?=\S)/gi, (m) => m.replace(/\s+/g, ''));
    out = out.replace(URL_IN, (m) => {
      const found = trimUrl(m);
      const tail = m.slice(found.length);
      if (urls.includes(found)) return m;
      const near = urls.find((u) => pathOf(u) != null && pathOf(u) === pathOf(found) && editDistance(found.toLowerCase(), u.toLowerCase()) <= Math.max(3, Math.floor(u.length * 0.25)));
      return near ? near + tail : m;
    });
  }
  for (const c of codes) {
    const loose = new RegExp(`\\b${c.split(/[-_]/).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s\\-_–—]?')}\\b`, 'gi');
    out = out.replace(loose, c);
  }
  return out;
}

// A sentence telling the learner an objective is met: "That's Objective 2
// met", "This closes Objective 4", "Objective 1 ✅".
const MET_WORDS = /\b(?:met|meets|shown|demonstrated|done|complete[ds]?|covered|achieved|closes?|closed|nailed|hit|checked off|fully)\b|✅/i;

/**
 * The reply without its sentences saying objectives plato didn't keep are
 * met. The coach told a learner "That's Objective 2 met" on a turn the
 * grading check had taken objective 2 back, so its words and the record
 * disagreed (Blake's trace, 2026-11-25). `numbers`: 1-based objectives not
 * kept. Pure; never empties a reply.
 */
export function withoutUnbackedClaims(text, numbers) {
  const t = String(text || '');
  if (!numbers?.length) return t;
  const wanted = new Set(numbers.map(Number));
  const claims = (sentence) => {
    if (!MET_WORDS.test(sentence)) return false;
    const refs = [...sentence.matchAll(/\bobjectives?\s*#?\s*(\d)(?:\s*(?:[-–—]|to|and|&|,)\s*(\d))?/gi)];
    return refs.some((m) => {
      const a = Number(m[1]); const b = m[2] ? Number(m[2]) : a;
      for (let n = Math.min(a, b); n <= Math.max(a, b); n++) if (wanted.has(n)) return true;
      return false;
    });
  };
  const paragraphs = t.split(/(\n\s*\n)/);
  const out = paragraphs.map((p) => (/^\n\s*\n$/.test(p) ? p : (p.match(/[^.!?\n]+(?:[.!?]+["”’)*]*|$)\s*/g) || [p]).filter((x) => !claims(x)).join('').trimEnd())).join('');
  const cleaned = out.replace(/\n{3,}/g, '\n\n').trim();
  return cleaned || t;
}

/**
 * True when most of a learner's message is the coach's own earlier wording
 * sent back: more than COPIED_SHARE of its three-word phrases are in the
 * coach's messages (`coachTexts`). A pasted hint was praised as the
 * learner's thinking ("You nailed it", Blake on playground, 2026-11-25), and
 * prompt rules alone didn't stop it (2 of 16). Pure.
 */
export function repeatsCoach(text, coachTexts = []) {
  const ws = normalizeForMatch(text).split(' ').filter(Boolean);
  if (ws.length < COPY_WORDS || !coachTexts.length) return false;
  const theirs = ` ${coachTexts.map((t) => normalizeForMatch(t)).join(' | ')} `;
  const grams = ws.slice(2).map((_, i) => ws.slice(i, i + 3).join(' '));
  return grams.filter((g) => theirs.includes(` ${g} `)).length / grams.length > COPIED_SHARE;
}

/** The note on a turn whose message repeats the coach's own wording (repeatsCoach). */
export const REPEATED_ADDENDUM = `## The learner's message repeats your words (from plato, not the learner)

Most of the learner's last message is your own wording sent back: a hint, an example or an explanation from your earlier messages. It doesn't show their thinking. Open by saying so ("That's my hint word for word"), not by agreeing with it: no "exactly", "that's right", "spot on" or "you're describing…". Don't count it toward an objective. Then ask them to say it in their own words.

Your whole reply is two sentences: one saying it's your wording, then one question. For example: "That's my wording, not your thinking yet. How would you put it in your own words?" Nothing after the question.`;

// "(e.g., “I coordinate with event teams in real time.”)", "For example: “I
// can make charts but don't use pivot tables.”": an example given as a quote.
const SAMPLE = /\s*\(\s*(?:e\.g\.|eg|for example|example|like)[,:]?\s*(["“])([^"”\n]{1,400})["”][^)]{0,80}\)|\s*(?:e\.g\.|for example|example)[,:]?\s*(["“])([^"”\n]{1,400})["”]/gi;

/**
 * The reply without its quoted examples in the learner's own voice that the
 * learner didn't write (the same test as draftsForLearner's): the draft
 * guard's rewrite kept them, and a learner who wanted the answer adapted
 * them and completed the lesson (agent evaluations W5). The question and the
 * rest of the reply stay. Pure.
 */
export function withoutVoiceSamples(text, learnerTexts = []) {
  const said = normalizeForMatch(learnerTexts.join('\n'));
  const out = String(text || '').replace(SAMPLE, (m, _q1, a, _q2, b) => {
    const span = (a ?? b ?? '').trim();
    const voice = VOICE.test(span) && span.split(/\s+/).filter(Boolean).length >= VOICE_WORDS && !said.includes(normalizeForMatch(span));
    return voice ? '' : m;
  });
  return out.replace(/[ \t]+([.,;:!?])/g, '$1').replace(/\(\s*\)/g, '').replace(/[ \t]{2,}/g, ' ');
}

/** The note on a turn where the learner only agreed ("yes, that's me") to a draft the coach wrote (C2). */
export const AGREED_ADDENDUM = `## The learner only agreed to your wording (from plato, not the learner)

Your last message wrote text for the learner, and they only said yes to it ("that's me", "post it"). That isn't their work and it isn't their voice. Don't call it theirs or praise it.

Your whole reply is two sentences: one saying the wording is still yours, then one question asking them to write it themselves. For example: "Those are still my words, not yours yet. How would you say it yourself?" Nothing after the question.`;

/** The coach's addendum when its reply wrote the learner's text for them. */
export const DRAFT_ADDENDUM = `## Let them write it (from plato, not the learner)

Your reply wrote a sentence or passage for the learner to use as their own answer. Learners copy these, and copied text doesn't count as their work. Write your reply again:
- One or two sentences of specific feedback on what they wrote.
- Then one question asking them to write the next piece themselves. Anything it should cover goes inside that question in a few words ("Can you write that in your own words, maybe with what the food drive taught you?"), never as more questions or a sample sentence.
- No quoted or italic sample sentences. One question mark in the whole reply. Then your tags.`;

/**
 * The reply plato shows when completion is held and the coach's own words
 * still say the lesson is done: plain, kind, and naming the first thing
 * still needed.
 */
export function heldReply(kb, outstanding, missing) {
  const names = outstanding.map((n) => objectiveForLearner(kb.objectives?.[n - 1])).filter(Boolean);
  // The reasons in `missing` are written for the coach ("the learner's own
  // words"), so they stay out of this learner-facing reply. The one worth
  // telling the learner is that their message repeated the coach's wording.
  const copied = outstanding.some((n) => missing?.[n] === COACH_WROTE)
    ? ' Some of what you sent repeats my wording, and that doesn’t count as yours.'
    : outstanding.some((n) => missing?.[n] === ONLY_AGREES) ? ' Saying yes to my wording doesn’t show it in your own words.'
      : outstanding.some((n) => missing?.[n] === ONLY_URL) ? ' I can’t open a link you type: attach the page with the link button, or send a screenshot.' : '';
  const list = names.length > 1 ? `\n\nStill to show in your own words:\n${names.map((x) => `- ${x}`).join('\n')}` : '';
  return `You're close, but this lesson isn't complete yet.${copied} The next step is yours: **${names[0] || 'the remaining objective'}**. A few plain sentences in your own words is enough. Send it when you're ready.${list}`;
}

/**
 * The coach's addendum that puts one of plato's fixed messages (heldReply)
 * into the learner's language, when it isn't English. The message is plato's;
 * the coach only translates it.
 */
export function localizeAddendum(text) {
  return `## A message from plato (not the learner)

Reply with ONLY the message below, written in the learner's language (\`learnerLanguage\` in the context). Keep its meaning, its bold and its list; add nothing; no tags.

${text}`;
}

/** The learner-visible "Where you are" note on a held turn, when the coach's says the lesson is done. */
export function heldPosition(kb, outstanding) {
  const names = outstanding.map((n) => objectiveForLearner(kb.objectives?.[n - 1])).filter(Boolean);
  return `Close to the exemplar. Still to show in your own words: ${names.join('; ')}.`;
}
