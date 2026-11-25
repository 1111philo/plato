/**
 * Turns stored Trace records (lib/lessonTrace.js) into what the Trace view
 * shows (#595): for each turn, who shaped the result, where plato stepped in,
 * and every step as a plain sentence with the exact text behind it.
 *
 * Built from what was recorded, not from today's code: an agent is described
 * by the header its call recorded, a rule is worked out from the values the
 * turn recorded (so a corrected rule also corrects old traces), and numbers
 * and tag names come from the step that used them. lib/transparency.js has
 * the wording.
 *
 * Pure. Unit tests: client/tests/traceView.test.js.
 */
import { AGENTS, STEPS, STAGES, CHECKS, RULES, SOURCES, PROMPT_PARTS, CONTEXT_FIELDS, EVENTS, SERVICES } from './transparency.js';
import { MAX_PROGRESS, MAX_EXCHANGES } from './constants.js';
import { rebuildRequest } from './lessonTrace.js';
import { parseAgentHeader } from '../../js/agentHeader.js';
import { TAG_REPAIR_CUE, READY } from '../../js/promptAssembly.js';
import { LESSON_KB_CHECKS } from '../../js/validators.js';
import { NOTE_RULE_REASONS } from '../../js/learnerNoteFilter.js';

const pretty = (v) => (typeof v === 'string' ? v : JSON.stringify(v, null, 2));
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const clip = (s, n = 90) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const agentLabel = (id) => AGENTS[id]?.label || id;
// Agents' names, as their prompt files give them.
const N = {
  owner: agentLabel('lesson-owner'), assessor: agentLabel('assessor'), claim: agentLabel('claim-check'),
  profile: agentLabel('learner-profile-update'), course: agentLabel('course-progress-update'),
};
const seconds = (ms) => (ms == null ? null : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);
const list = (arr) => arr.filter(Boolean).join(', ');
// A field's label: the registry's, or its name made readable ("learnerNotes" →
// "Learner notes"), so a field added to the code shows up without a change here.
const humanize = (k) => String(k).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase()).replace(/ ([A-Z])(?=[a-z])/g, (m, c) => ` ${c.toLowerCase()}`);
const fieldLabel = (k) => CONTEXT_FIELDS[k]?.label || humanize(k);

/** Message content as readable text (a stored message can hold text, an attached page, or an image). */
function contentText(content) {
  if (typeof content === 'string') return content;
  if (content && typeof content === 'object' && !Array.isArray(content) && 'excerpt' in content) return `${content.excerpt}\n… (${content.chars.toLocaleString()} characters in all; the rest of the attached page isn’t kept in the trace)`;
  if (!Array.isArray(content)) return pretty(content);
  return content.map((b) => {
    if (b.type === 'image') return `[an image: ${b.mediaType || 'unknown type'}, about ${Math.round((b.base64Chars * 0.75) / 1024)} KB]`;
    if ('excerpt' in b) return contentText(b);
    return b.text ?? pretty(b);
  }).join('\n\n');
}

/**
 * Who wrote each message of a request. The model sees only two roles, the
 * "user" turn and its own, but plato's code writes some of both: what it
 * gathered, a fixed "Ready.", the request for tags.
 */
function speaker(m, i, all, agent) {
  const text = typeof m.content === 'string' ? m.content : '';
  const last = i === all.length - 1;
  if (agent !== 'coach') return last ? 'plato: what this agent is asked to work on' : (m.role === 'assistant' ? 'the model' : 'plato');
  if (i === 0 && m.role === 'user' && /^\s*\{/.test(text)) return 'plato: what it gathered about you and the lesson';
  if (i === 1 && m.role === 'assistant' && text === READY) return 'plato, written as if the model had said it';
  if (last && m.role === 'user' && text === TAG_REPAIR_CUE) return 'plato: asking for the tags of the reply above';
  if (last && m.role === 'user') return text === 'Start the lesson.' ? 'plato: asking the coach to open the lesson' : 'you: this message';
  if (m.role === 'assistant') return i === all.length - 2 && all[all.length - 1]?.content === TAG_REPAIR_CUE ? 'the coach: the reply that had no tags' : 'the coach: an earlier reply';
  return 'you: an earlier message';
}
// `seen(text)`: the exchange a long message was first shown in, so a repeat
// points there instead of being written out again.
function messagesText(messages, agent, seen) {
  return messages.map((m, i, all) => {
    const text = contentText(m.content);
    const first = text.length >= 200 ? seen?.(text) : null;
    return `— ${i + 1}. ${speaker(m, i, all, agent)} —\n${first ? `(the same as in exchange ${first})` : text}`;
  }).join('\n\n');
}

const chars = (n) => `${Number(n || 0).toLocaleString()} ${n === 1 ? 'character' : 'characters'}`;
const textLength = (content) => (typeof content === 'string' ? content.length : Array.isArray(content) ? content.reduce((n, b) => n + (b.text?.length || b.excerpt?.length || 0), 0) : content?.excerpt?.length || 0);

/**
 * One AI call as two steps: the request (who it was for, what was sent and
 * how big it was) and the reply (what came back, how long it took, why it
 * stopped).
 */
function callSteps(s, { history, parts, sameAs, seenMessage }) {
  const req = rebuildRequest(s, { history, parts });
  const p = s.server?.provider;
  const where = p ? (p.provider === 'mock' ? 'a stand-in model used for testing' : `${p.model} on Amazon Bedrock${p.region ? ` (${p.region})` : ''}`) : 'the AI model';
  // Which agent this was, from its prompt file's header as it was at the
  // time: recorded beside the call (`about`; the header isn't sent to the
  // model), or, in a trace from before that, read from the instructions sent.
  // Today's registry is the fallback when neither is stored.
  const promptPart = s.system.find((part) => part.kind === 'prompt');
  const sentText = promptPart ? (promptPart.hash ? parts[promptPart.hash] : promptPart.text) : null;
  const sent = sentText ? parseAgentHeader(sentText) : null;
  const header = s.about || sent;
  const today = AGENTS[s.agent];
  // A field the recorded header didn't have comes from today's description,
  // and the card says which fields those are.
  const recorded = header || {};
  const pick = (k, todayKey, empty) => {
    const v = recorded[k];
    if (v && (!Array.isArray(v) || v.length)) return { v, today: false };
    const t = today?.[todayKey];
    return { v: t && (!Array.isArray(t) || t.length) ? t : empty, today: !!t };
  };
  const fields = { purpose: pick('purpose', 'purpose', ''), runs: pick('runs', 'when', ''), reads: pick('reads', 'reads', []), returns: pick('returns', 'writes', []) };
  const agentInfo = {
    name: recorded.name || agentLabel(s.agent),
    purpose: fields.purpose.v, runs: fields.runs.v, reads: fields.reads.v, returns: fields.returns.v,
    from: header ? (s.about ? 'file' : 'sent') : null,
    fromToday: header ? Object.keys(fields).filter((k) => fields[k].today) : [],
  };
  const who = agentInfo.name;
  const instructionChars = s.system.reduce((n, part) => n + (part.chars || 0), 0);
  const messageChars = req.messages.reduce((n, m) => n + textLength(m.content), 0);
  const images = req.messages.reduce((n, m) => n + (Array.isArray(m.content) ? m.content.filter((x) => x.type === 'image').length : 0), 0);
  // A count of 0 means the model didn't report one (the test stand-in never does).
  const tokensIn = s.usage?.input_tokens || null;
  const tokensOut = s.usage?.output_tokens || null;
  const request = {
    title: `Sent to the ${who}${s.purpose ? `: ${s.purpose}` : ''}`,
    summary: [
      `plato sent ${where} the ${who}’s instructions (${chars(instructionChars)}, in ${plural(s.system.length, 'part')}${sameAs ? `, the same as in exchange ${sameAs}` : ''}) and ${plural(req.messages.length, 'message')} (${chars(messageChars)}${images ? `, ${plural(images, 'image')}` : ''}).`,
      tokensIn ? `The model counted it as ${tokensIn.toLocaleString()} tokens.` : null,
      `It allowed a reply of up to ${s.maxTokens.toLocaleString()} tokens${s.temperature != null ? ` at temperature ${s.temperature}` : ''}.`,
      s.attempts?.length ? `The first ${plural(s.attempts.length, 'try', 'tries')} failed and ${s.attempts.length === 1 ? 'was' : 'were'} sent again.` : null,
    ].filter(Boolean).join(' '),
    details: [
      ...s.system.map((part) => ({
        label: `Instructions, part ${s.system.indexOf(part) + 1} of ${s.system.length}: ${PROMPT_PARTS[part.kind]?.label || part.kind} (${SOURCES[PROMPT_PARTS[part.kind]?.source]?.label || 'plato'})`,
        note: PROMPT_PARTS[part.kind]?.means,
        text: part.hash ? parts[part.hash] ?? `(${part.chars.toLocaleString()} characters; this part’s text isn’t stored any more)` : part.text,
      })),
      { label: `Messages (${req.messages.length}): the conversation the model replies to`, text: messagesText(req.messages, s.agent, seenMessage) },
      { label: 'Settings: limits on the reply, not what it says', text: list([
        `Longest reply allowed: ${s.maxTokens} tokens`,
        s.temperature != null ? `temperature ${s.temperature} (0 means the same input gives the same answer)` : 'temperature: the model’s default',
        s.server?.applied?.dropped?.length ? `fields the server dropped: ${s.server.applied.dropped.join(', ')}` : null,
      ]) },
      ...(s.attempts?.length ? [{ label: `Tries that failed (${s.attempts.length})`, text: s.attempts.map((a) => `${a.type}: ${a.message || ''}${a.server?.limit ? ` (plato’s own limit: ${LIMIT[a.server.limit] || a.server.limit})` : ''}`).join('\n') }] : []),
    ],
  };
  const reply = s.error
    ? {
      title: `The ${who} didn’t reply`,
      summary: `It failed after ${seconds(s.took) || 'a moment'}: ${s.error.message}`,
      details: [{ label: 'The error', text: pretty(s.error) }],
    }
    : {
      title: `The ${who} replied`,
      summary: [
        `${chars((s.reply || '').length)}${tokensOut ? ` (${tokensOut.toLocaleString()} tokens)` : ''}, after ${seconds(s.took) || 'a moment'}.`,
        s.stopReason ? `It stopped because ${STOP[s.stopReason] || s.stopReason}.` : null,
        s.server?.attempts > 1 ? `Amazon’s service needed ${s.server.attempts} tries.` : null,
      ].filter(Boolean).join(' '),
      details: [
        ...(s.reply != null ? [{ label: 'The model’s raw reply', text: s.reply }] : []),
        ...(s.reasoning ? [{ label: 'The model’s own reasoning', text: s.reasoning }] : []),
      ],
    };
  return { request, reply, took: s.took, agentInfo };
}

const STOP = {
  end_turn: 'it had finished',
  max_tokens: 'it reached the longest reply allowed, so the reply was cut off',
  content_filtered: 'a content filter stopped it',
  stop_sequence: 'it reached a stop marker',
};
const LIMIT = { rate: 'too many AI calls in a minute for one person', in_flight: 'too many AI calls at once for one person' };

function saveSentence(s) {
  const what = { lessonKB: 'this lesson’s progress and notes', messages: 'the conversation' }[s.record] || s.record;
  if (s.ok) return `Saved ${what}.${s.conflict ? ' Another device had saved a newer copy first; this one replaced it.' : ''}`;
  const why = s.code === 'too_long' ? 'the conversation is past the size limit' : s.code === 'network' ? 'the network request failed' : s.code || (s.status ? `the server answered ${s.status}` : 'unknown reason');
  return `Saving ${what} failed (${why}). plato tries once more in the background.`;
}


/**
 * The rules plato's code applied in a turn, worked out from what the turn
 * recorded (the scores and states before and after, and the grading check's
 * steps), not read from a list stored at the time. A rule fixed later then
 * reads correctly in an old trace too. Returns null when the record lacks the
 * values (a stored list is used then).
 */
export function deriveRules(steps) {
  const applied = steps.find((x) => x.type === 'applied');
  if (!applied || applied.opener || !('replyProgress' in applied) || !applied.status) return null;
  const has = (t) => steps.some((x) => x.type === t);
  const verdict = steps.find((x) => x.type === 'verdictApplied');
  const asked = applied.replyProgress;
  const wasCompleted = applied.status.before === 'completed';
  const nowCompleted = applied.status.after === 'completed';
  const rules = [];
  if (asked == null) rules.push('noProgressTag');
  if (asked != null && (!Number.isInteger(asked) || asked < 0 || asked > MAX_PROGRESS)) rules.push('clamped');
  if (verdict?.held) rules.push('heldAt8');
  if (has('gradingStood')) rules.push('checkFailedTwiceGradingStood');
  else if (has('gradingFailed')) rules.push('checkFailedNothingCounted');
  if (verdict?.unverified?.length) rules.push('objectivesNotBackedUp');
  if (has('replyReplaced')) rules.push('replyReplaced');
  if (wasCompleted) rules.push('frozenAfterCompletion');
  else if (asked != null && asked >= MAX_PROGRESS && !nowCompleted && !verdict?.held) rules.push('cappedAt9');
  if (!wasCompleted && nowCompleted) rules.push('completed');
  return rules;
}

const rulesOf = (steps) => deriveRules(steps) ?? steps.find((x) => x.type === 'applied')?.rules ?? [];

/** The plain sentence and exact text for every step type but `call`. */
const DESCRIBE = {
  lesson: (s) => ({
    summary: `“${s.name}”${s.updatedAt ? `, last edited ${new Date(s.updatedAt).toLocaleDateString()}` : ''}${s.unit ? `, in the unit “${s.unit}”` : ''}.`,
    details: [
      { label: 'Exemplar (the author’s)', text: s.exemplar || '(none)' },
      { label: 'Objectives (the author’s)', text: (s.learningObjectives || []).map((o, i) => `${i + 1}. ${o}`).join('\n') || '(none)' },
      ...(s.coachDirective ? [{ label: 'The author’s instructions to the coach', text: s.coachDirective }] : []),
    ],
  }),
  planned: (s) => ({
    summary: `The ${N.owner} turned the author’s ${plural((s.authorObjectives || []).length, 'objective')} into ${(s.fromModel?.objectives || []).length}, each with what would count as evidence. The coach and the ${N.assessor} work from this version.`,
    details: [
      { label: `Objectives and evidence (the ${N.owner}’s version)`, text: (s.fromModel?.objectives || []).map((o, i) => `${i + 1}. ${o.objective}\n   Evidence: ${o.evidence || '(none given)'}`).join('\n') },
      { label: 'Objectives (the author’s wording)', text: (s.authorObjectives || []).map((o, i) => `${i + 1}. ${o}`).join('\n') },
      ...(s.fromModel?.exemplar && s.fromModel.exemplar !== s.authorExemplar ? [{ label: `Exemplar (the ${N.owner}’s copy, which the coach uses)`, text: s.fromModel.exemplar }] : []),
      { label: `Everything the ${N.owner} returned`, text: pretty(s.fromModel) },
    ],
  }),
  validation: (s) => ({
    summary: s.ok && !s.firstError
      ? `plato’s code checked the setup for the ${LESSON_KB_CHECKS.length} things the coach and the ${N.assessor} need. All were there.`
      : s.ok
        ? `The first setup was missing something (${s.firstError}), so plato asked the ${N.owner} again. The second had all ${LESSON_KB_CHECKS.length}.`
        : `The first setup was missing something (${s.firstError}), and so was the second (${s.secondError}). plato used the second anyway, so the lesson could start.`,
    details: [{ label: 'What plato checks for', text: LESSON_KB_CHECKS.map((c, i) => `${i + 1}. ${c}`).join('\n') }],
  }),
  plugins: (s) => ({
    summary: s.failed ? `Asking plugins for background failed (${s.failed}); the lesson started without it.` : s.enrichments?.length ? `${plural(s.enrichments.length, 'plugin')} added background for the coach: ${s.enrichments.map((e) => e.label || e.pluginId).join(', ')}.` : 'No plugin added anything.',
    details: [
      ...(s.enrichments || []).flatMap((e) => [
        { label: `${e.label || e.pluginId}: what it gave the coach`, text: e.context || '(nothing)' },
        { label: `${e.label || e.pluginId}: why`, text: e.reasoning || '(not given)' },
        ...(e.sources?.length ? [{ label: `${e.label || e.pluginId}: sources`, text: e.sources.map((x) => `${x.title || x.url}\n${x.url}`).join('\n\n') }] : []),
      ]),
      // What each plugin did to get there: its own AI calls and outside requests.
      ...Object.entries(s.pluginTraces || {}).map(([id, steps]) => ({ label: `${id}: every step it took (${(steps || []).length})`, text: (steps || []).map(pluginStepText).join('\n\n') || '(nothing recorded)' })),
    ],
  }),
  input: (s) => {
    const notSent = (s.images || []).filter((i) => !i.sent);
    return {
      summary: list([
        s.text ? `You wrote: “${clip(s.text, 120)}”` : 'No text',
        s.images?.length ? plural(s.images.length, 'image') : null,
        s.links?.length ? plural(s.links.length, 'attached page') : null,
      ]) + '.' + (notSent.length ? ` ${plural(notSent.length, 'image')} couldn’t be given to the model (type ${notSent.map((i) => i.type).join(', ')}).` : ''),
      details: [
        ...(s.text ? [{ label: 'Your message', text: s.text }] : []),
        ...(s.images || []).map((i, n) => ({ label: `Image ${n + 1}`, text: `${i.type || 'unknown type'}, about ${Math.round((i.chars * 0.75) / 1024)} KB as sent. ${i.sent ? 'Given to the model.' : `Not given to the model: plato doesn’t send images of type ${i.type || 'unknown'}.`}` })),
        ...(s.links || []).map((l) => ({ label: `Attached page: ${l.title || l.url}`, text: `${l.url}${l.finalUrl ? `\n(redirected to ${l.finalUrl})` : ''}\n${l.chars.toLocaleString()} characters of page text were given to the model${l.truncated ? ' (the page was longer and was cut)' : ''}.` })),
      ],
    };
  },
  state: (s) => ({
    summary: `Before this message: progress ${s.progress} of 10, ${plural(s.objectivesMet.length, 'objective')} checked off, ${plural(s.activitiesCompleted, 'exchange')} so far${s.status === 'completed' ? ', lesson already complete' : ''}.`,
  }),
  tail: (s) => ({
    summary: `${plural(s.sent, 'earlier message')} sent as the conversation so far.${s.olderLeftOut ? ` ${plural(s.olderLeftOut, 'older message')} left out (only the latest ${s.limit ?? s.sent} are sent).` : ''}${s.earlierImages || s.earlierLinks ? ` Images and attached pages from earlier messages aren’t sent again, so the coach can’t see them now.` : ''}`,
  }),
  context: (s, { prevContext } = {}) => {
    const keys = Object.keys(s.context);
    const field = (k) => ({ label: `${fieldLabel(k)} (${SOURCES[CONTEXT_FIELDS[k]?.source]?.label || 'plato'})`, note: CONTEXT_FIELDS[k]?.from, text: pretty(s.context[k]) });
    if (!prevContext) {
      return { summary: `plato’s code sent the coach ${plural(keys.length, 'detail')} about you and the lesson.`, details: keys.map(field) };
    }
    const changed = keys.filter((k) => JSON.stringify(s.context[k]) !== JSON.stringify(prevContext[k]));
    const removed = Object.keys(prevContext).filter((k) => !(k in s.context));
    const same = keys.filter((k) => !changed.includes(k));
    return {
      summary: changed.length || removed.length
        ? `Changed since the last exchange: ${list([...changed.map((k) => fieldLabel(k).toLowerCase()), ...removed.map((k) => `${fieldLabel(k).toLowerCase()} (no longer sent)`)])}. ${plural(same.length, 'other detail')} the same.`
        : `The same ${plural(keys.length, 'detail')} as the last exchange.`,
      details: [
        ...changed.map(field),
        ...(same.length ? [{ label: `Unchanged since the last exchange (${same.length})`, text: same.map((k) => fieldLabel(k)).join('\n') }] : []),
      ],
    };
  },
  history: (s) => ({
    summary: `${plural(s.messages.length, 'message')}: what plato gathered, a fixed “Ready.”, the conversation so far, and this message.`,
    details: [{ label: 'The messages', text: messagesText(s.messages) }],
  }),
  parsed: (s, ctx) => ({
    note: s.tags ? `plato’s code looks for these tags: ${Object.values(s.tags).map((t) => `[${t}]`).join(', ')}.` : undefined,
    summary: list([
      s.progress != null ? `Progress score: ${s.progress} of 10` : 'No progress score in the reply',
      s.kbUpdate?.objectivesMet?.length ? `objectives it says are met: ${s.kbUpdate.objectivesMet.join(', ')}` : null,
      s.kbUpdate?.insights?.length ? plural(s.kbUpdate.insights.length, 'note') : null,
      s.profileUpdate?.observation ? 'an observation for your profile' : null,
    ]) + '.',
    details: [
      { label: 'The reply with its tags, as the model wrote it', text: s.raw },
      // The text shown is "You saw" at the top of the exchange, unless something replaced it.
      ...(s.text !== ctx?.saw ? [{ label: 'The text before its tags', text: s.text }] : []),
      ...(s.kbUpdate ? [{ label: 'Notes for this lesson', text: pretty(s.kbUpdate) }] : []),
      ...(s.profileUpdate ? [{ label: 'Observation for your profile', text: pretty(s.profileUpdate) }] : []),
    ],
  }),
  tagCheck: (s) => {
    const missing = [!s.progress && 'the progress score', !s.notes && 'the notes'].filter(Boolean);
    const of = s.for === 'rewrite' ? 'the rewritten reply' : 'the reply';
    return { summary: missing.length
      ? `No: ${of} was missing ${missing.join(' and ')}, so that part couldn’t be recorded. plato asked the coach for just its tags.`
      : `Yes: ${of} had the progress score and the notes${s.profile ? ', and an observation for your profile' : ''}.` };
  },
  draftCheck: (s) => ({
    summary: s.skipped ? 'Not checked: the lesson is already complete, so the conversation is for feedback.' : s.drafts ? 'Yes: the reply wrote out an answer for you to use. plato asked the coach to rewrite it as feedback and a question.' : 'No: the reply gave feedback without writing your answer for you.',
    note: s.minWords ? `A quoted passage of ${s.minWords} or more words counts as writing your answer.` : undefined,
  }),
  tagRepair: (s) => ({
    summary: s.recovered ? 'plato asked the coach for the tags of the reply it had given, and got them.' : 'plato asked the coach for the missing tags and still didn’t get them all, so nothing was recorded for what was missing.',
    details: [{ label: 'What came back', text: pretty({ progress: s.progress, notes: s.kbUpdate, profile: s.profileUpdate }) }],
  }),
  draftGuard: (s) => ({
    summary: s.failed ? `plato asked for a rewrite, which failed (${s.failed}), so the first reply was kept.` : s.used ? `plato showed the rewrite in place of the first reply.${s.stillDrafts ? ' The rewrite still drafted an answer.' : ''}` : 'The rewrite came back empty, so the first reply was kept.',
    change: s.after ? { before: s.before, after: s.after } : null,
  }),
  literals: (s) => ({ summary: 'plato put back the lesson author’s exact link or code.', change: { before: s.before, after: s.after } }),
  scriptCheck: (s) => ({ summary: s.mixed ? 'No: the reply had characters from another language. plato asked the coach to write it again.' : 'Yes.' }),
  scriptGuard: (s) => ({
    summary: s.failed ? `plato asked for a rewrite, which failed (${s.failed}), so the reply was kept.` : s.used ? 'plato showed the rewrite in place of the first reply.' : 'The rewrite still mixed languages, so the reply was kept.',
    change: s.used && s.after ? { before: s.before, after: s.after } : null,
  }),
  gradingPlan: (s) => ({
    summary: !s.ran ? 'Not needed: the coach didn’t check off a new objective or score 10.' : `The coach ${s.completionClaimed ? 'scored 10' : 'checked off an objective'}, so plato checked ${plural(s.check.length, 'objective')}: ${s.check.join(', ')}.`,
  }),
  gradingRetry: (s) => ({ summary: `The ${N.assessor}’s first answer couldn’t be read (${s.why}); plato asked again.` }),
  verdict: (s) => ({
    summary: `Shown in your own words: ${s.shown.length ? s.shown.join(', ') : 'none'}. Not shown: ${Object.keys(s.missing).length ? Object.keys(s.missing).join(', ') : 'none'}.`,
    details: [
      ...Object.entries(s.evidence || {}).map(([n, quotes]) => ({
        label: `Objective ${n}: the quotes it relied on`,
        text: quotes.map((q) => `“${q.quote}”\n  ${q.ok ? `Found in your message (message ${q.learnerAt + 1} of the conversation it read).` : q.coachAt !== -1 ? `The coach wrote this first (message ${q.coachAt + 1}), so it doesn’t count as yours.` : 'Not found in anything you wrote.'}`).join('\n\n'),
      })),
      ...Object.entries(s.missing).map(([n, why]) => ({ label: `Objective ${n}: why it didn’t count`, text: String(why) })),
      { label: `The ${N.assessor}’s full answer`, text: pretty(s.verdict) },
      { label: 'The conversation it read', text: (s.transcript || []).map((m, i) => `${i + 1}. ${m.by}: ${m.text}`).join('\n\n') },
    ],
  }),
  recheck: (s) => ({
    summary: s.failed ? `Asking again failed (${s.failed}); the first answer was kept.` : `Asked again about ${plural(s.asked.length, 'objective')}. Now shown: ${s.shown?.length ? s.shown.join(', ') : 'none'}.`,
    details: s.verdict ? [{ label: 'The second answer', text: pretty(s.verdict) }] : [],
  }),
  gradingFailed: (s) => ({ summary: `The check failed (${s.why}). ${s.failuresBefore ? 'It had also failed on the previous completing turn.' : 'Nothing new was checked off this turn.'}` }),
  gradingStood: () => ({ summary: 'Two failed checks in a row on a completing turn: the coach’s grading was accepted so the learner isn’t stuck.' }),
  verdictApplied: (s) => ({
    summary: list([
      s.held ? `Completion was held: ${plural(s.outstanding.length, 'objective')} not yet shown in your own words (${s.outstanding.join(', ')})` : null,
      s.unverified.length ? `${plural(s.unverified.length, 'objective')} the coach checked off ${s.unverified.length === 1 ? 'was' : 'were'} taken back off (${s.unverified.join(', ')})` : null,
      !s.held && !s.unverified.length ? 'The check agreed with the coach' : null,
    ]) + '.',
    change: s.progressBefore !== s.progressAfter ? { before: `Score ${s.progressBefore}`, after: `Score ${s.progressAfter}` } : null,
    details: Object.entries(s.missing || {}).map(([n, why]) => ({ label: `Objective ${n}: what’s missing`, text: String(why) })),
  }),
  heldRewrite: (s) => ({
    summary: s.failed ? `The new reply failed (${s.failed}); the first was kept, with completion still held.` : `The coach replied again.${s.progressAsked != null && s.progressAsked !== s.progressKept ? ` It scored ${s.progressAsked}; plato’s code kept ${s.progressKept}.` : ''}`,
    change: s.after ? { before: s.before, after: s.after } : null,
  }),
  claimCheck: (s) => ({
    summary: [
      'Completion was held, so the reply mustn’t tell you the lesson is done.',
      s.byPattern
        ? 'plato’s code found wording it knows means “done” (like “you’ve completed this lesson”).'
        : `plato’s code found none of the wording it knows means “done”, so it asked the ${N.claim}, an AI helper, for a yes or no: ${s.byModel === 'failed' ? 'that failed, so the reply was kept' : s.byModel ? 'yes' : 'no'}.`,
      s.saysDone ? 'So the reply was replaced.' : 'So the reply was kept.',
    ].join(' '),
  }),
  replyReplaced: (s) => ({ summary: 'The coach’s reply said the lesson was done while completion was held. plato’s code showed a standard message instead.', change: { before: s.before, after: s.after } }),
  positionReplaced: (s) => ({ summary: 'The coach’s “Where you are” note said the lesson was done while completion was held. plato’s code replaced it.', change: { before: s.before, after: s.after } }),
  applied: (s) => ({
    summary: s.opener
      ? `Opening score: ${s.progress ?? 0} of 10.`
      : `Progress ${s.progress.before} → ${s.progress.after} of 10. Objectives checked off: ${s.objectivesMet.after.length} of ${s.objectivesMet.total}.${s.status.before !== s.status.after ? ' The lesson was marked complete.' : ''}`,
    rules: (s.derivedRules || s.rules || []).map((id) => ({ id, text: RULES[id] || id })),
    details: s.opener ? [] : [
      { label: 'Score', text: `The model reported: ${s.modelProgress ?? 'nothing'}\nAfter plato’s checks: ${s.gradedProgress ?? 'nothing'}\nRecorded: ${s.progress.after}` },
      ...(s.newlyMet?.length ? [{ label: 'Newly checked off', text: s.newlyMet.join('\n') }] : []),
      ...(s.notesAdded?.length ? [{ label: 'Notes added', text: s.notesAdded.join('\n') }] : []),
      ...(s.learnerPosition.before !== s.learnerPosition.after ? [{ label: 'Where you are', text: s.learnerPosition.after }] : []),
      { label: 'Exchanges counted', text: `${s.exchanges.before} → ${s.exchanges.after}` },
    ],
  }),
  save: (s) => ({ summary: saveSentence(s) }),
  event: (s) => ({ summary: `${EVENTS[s.code] || s.code} (logged as “${s.code}”, with the lesson’s id and no conversation text.)` }),
  followUp: (s) => ({ summary: `${agentLabel(s.agent)} will run in the background because ${s.why}.`, details: s.observation ? [{ label: 'The coach’s observation', text: s.observation }] : [] }),
  followUpStart: (s) => ({ summary: `${agentLabel(s.agent)} ran because ${s.why}.` }),
  noteScreened: (s) => {
    const why = NOTE_RULE_REASONS[s.reason] || 'it reads like an instruction to the AI rather than information about you';
    return { summary: s.source === 'learner-removed'
      ? `The removed note had been held back from the ${N.profile}, because ${why}. There was nothing to undo.`
      : `plato’s code didn’t give this note to the ${N.profile}, because ${why}. Notes describe you; they can’t give the AI orders. The note itself is still saved, and you can remove it.` };
  },
  profileSaved: (s) => ({
    summary: (() => {
      const changed = ['name', 'goal', 'strengths', 'weaknesses', 'preferences'].filter((k) => JSON.stringify(s.before?.[k] ?? null) !== JSON.stringify(s.after?.[k] ?? null));
      return [
        changed.length ? `The ${N.profile} changed: ${changed.join(', ')}.` : `The ${N.profile} changed none of the profile’s fields.`,
        s.summary ? 'It rewrote the profile summary, which is what the coach reads.' : null,
        'plato’s code kept your own notes and your lesson lists as they were.',
      ].filter(Boolean).join(' ');
    })(),
    details: [
      ...(s.summary ? [{ label: 'New summary (what the coach is given)', text: s.summary }] : []),
      { label: 'Profile before', text: pretty(s.before) },
      { label: 'What the agent returned', text: pretty(s.returned) },
      { label: 'Profile after (your own notes and lesson lists are kept by plato’s code)', text: pretty(s.after) },
    ],
  }),
  profileUnchanged: (s) => ({ summary: `Your profile wasn’t changed: ${s.why}.` }),
  unitNoteSaved: (s) => ({ summary: 'The unit note was rewritten.', change: { before: s.before || '(no note yet)', after: s.after } }),
  unitNoteUnchanged: (s) => ({ summary: `The unit note wasn’t changed: ${s.why}.` }),
  noteChange: (s) => ({
    summary: `You ${s.action === 'removed' ? 'removed' : 'added'} a note: “${clip(s.text, 120)}”. ${s.action === 'removed' ? 'It was taken off your profile' : 'It was kept with your profile, word for word'}${s.saved ? '' : ', and plato is still saving that'}.`,
    details: [{ label: 'The note', text: s.text }],
  }),
  shown: (s) => ({
    // Before 2026-11-25 replies streamed as they were written (`firstStreamed`),
    // so a replaced one had been seen; now plato checks first (`firstReply`).
    summary: !s.replaced ? 'The reply you saw is the one the model wrote.'
      : s.streamedLive === false ? 'plato checked the model’s first reply and showed you the one below instead. You didn’t see the first one.'
        : 'You watched a first reply arrive, and then it was replaced by the one below.',
    change: s.replaced ? { before: s.firstReply ?? s.firstStreamed, after: s.text } : null,
    details: s.replaced ? [] : [{ label: 'The reply', text: s.text }],
  }),
  error: (s) => ({ summary: `${s.error.message}${s.error.type ? ` (${s.error.type})` : ''}`, details: [{ label: 'The error', text: pretty(s.error) }] }),
};

/** One step a plugin recorded at lesson start (server lib/plugins/trace.js), as text. */
function pluginStepText(st, i) {
  const n = `${i + 1}.`;
  if (st?.type === 'ai') {
    return [
      `${n} Asked the AI model${st.model ? ` (${st.model})` : ''}: ${st.purpose || 'no purpose given'}${st.error ? `. It failed: ${st.error}` : ''}`,
      st.system ? `Instructions:\n${st.system}` : null,
      st.messages?.length ? `Sent:\n${st.messages.map((m) => `${m.role}: ${contentText(m.content)}`).join('\n')}` : null,
      st.reply != null ? `Reply:\n${st.reply}` : null,
      st.usage ? `${st.usage.input_tokens ?? '?'} tokens in, ${st.usage.output_tokens ?? '?'} out${st.ms != null ? `, ${seconds(st.ms)}` : ''}` : null,
    ].filter(Boolean).join('\n');
  }
  if (st?.type === 'fetch') return `${n} Requested ${st.url}: ${st.purpose || 'no purpose given'}${st.status ? ` (answered ${st.status})` : ''}${st.error ? `. It failed: ${st.error}` : ''}`;
  if (st?.type === 'note') return `${n} ${st.text}`;
  return `${n} ${pretty(st)}`;
}

/**
 * What was unusual in one turn: anything that went wrong, and every place
 * plato's code or instructions changed the model's answer. `[{ id, text }]`.
 */
/**
 * When plato stepped in or something went wrong at a step, a note to show on
 * that step: `{ kind: 'changed' | 'problem', text }`. `changed`: plato's code
 * or instructions changed what the model produced. `problem`: something
 * failed or was left out. The text says what happened and why it matters.
 */
function noteFor(s) {
  const changed = (text) => ({ kind: 'changed', text });
  const problem = (text) => ({ kind: 'problem', text });
  switch (s.type) {
    case 'error': return problem(`This attempt failed (${s.error.message}), so nothing from it was saved.`);
    case 'call':
      if (s.stopReason === 'max_tokens') return problem('The reply was cut off: it reached the longest reply allowed.');
      if (s.stopReason === 'content_filtered') return problem('A content filter stopped the reply.');
      if (s.error && s.agent !== 'coach') return problem(`This call failed (${s.error.message}).`);
      if (s.attempts?.length) return problem('The AI service was busy, so plato sent the request again.');
      return null;
    case 'input': return s.images?.some((i) => !i.sent) ? problem('An image you attached wasn’t given to the model, so the coach couldn’t see it.') : null;
    case 'validation': return s.firstError ? problem(s.ok ? `The ${N.owner}’s first setup was incomplete, so plato asked again.` : `The ${N.owner}’s setup was incomplete, and was used anyway so the lesson could start.`) : null;
    case 'plugins': return s.failed ? problem('Plugins couldn’t be asked for background, so the lesson started without it.') : null;
    case 'tagCheck': return null;
    case 'tagRepair': return s.recovered ? changed('the reply left out its tags, so plato asked the coach again for just those.') : problem('The tags couldn’t be recovered, so nothing from this reply was recorded.');
    case 'draftCheck': return s.drafts ? changed('plato asked the coach to rewrite this reply.') : null;
    case 'literals': return changed('the reply changed the author’s link or code slightly, so plato put back the exact text.');
    case 'scriptCheck': return s.mixed ? changed('the reply mixed in another language, so plato asked the coach to rewrite it.') : null;
    case 'gradingFailed': return problem(`The ${N.assessor} couldn’t run, so nothing new was checked off this time.`);
    case 'gradingStood': return changed('plato accepted the coach’s grading without the check, so you weren’t stuck.');
    case 'verdictApplied':
      if (s.held) return changed('plato held the lesson open: the coach scored 10, but not every objective was shown in your own words.');
      if (s.unverified?.length) return changed('plato took back an objective the coach checked off, because it wasn’t in your own words.');
      return null;
    case 'replyReplaced': return changed('plato replaced the coach’s reply with a standard message: what you saw isn’t what the model wrote.');
    case 'positionReplaced': return changed('plato replaced the coach’s “Where you are” note.');
    case 'applied': {
      const rules = s.derivedRules || s.rules || [];
      if (rules.includes('cappedAt9')) return changed(`plato’s code changed your score: the coach gave ${MAX_PROGRESS}, but it was recorded as ${MAX_PROGRESS - 1} because not every objective was checked off.`);
      if (rules.includes('noProgressTag')) return problem('The reply had no progress score, so your score didn’t change.');
      return null;
    }
    case 'context': {
      const steering = Object.keys(s.context || {}).filter((k) => CONTEXT_FIELDS[k]?.steers);
      return steering.length ? changed(`plato’s code added ${steering.length === 1 ? 'an instruction' : 'instructions'} for the coach: ${steering.map((k) => `${fieldLabel(k).toLowerCase()}${directiveWhy(k, s.context)}`).join('; ')}.`) : null;
    }
    case 'save':
      if (!s.ok) return problem(saveSentence(s));
      if (s.conflict) return problem('Another device had saved a newer copy of this lesson; this one replaced it.');
      return null;
    case 'profileUnchanged': case 'unitNoteUnchanged': return problem(DESCRIBE[s.type](s).summary);
    case 'noteScreened': return changed('plato held this note back from the AI model.');
    default: return null;
  }
}

/** Why plato's code added a steering field, from the values it was added beside. */
function directiveWhy(k, context) {
  if (k === 'pacingDirective' && context.activitiesCompleted != null) return ` (after ${plural(context.activitiesCompleted, 'exchange')}; lessons are designed for about ${MAX_EXCHANGES})`;
  if (k === 'postCompletionDirective') return ' (the lesson is complete)';
  return '';
}

/** Every note in a record, for the list's filter and the download. */
function flagsFor(record) {
  const flags = [];
  if (record.partial && record.kind === 'turn') flags.push({ id: 'partial', kind: 'info', text: 'Recording began partway through this lesson; earlier messages weren’t recorded.' });
  record.steps.forEach((st, i) => { const n = noteFor(st); if (n) flags.push({ id: `${st.type}-${i}`, ...n }); });
  return flags;
}

const CODE_RULES = new Set(['cappedAt9', 'heldAt8', 'clamped', 'objectivesNotBackedUp', 'checkFailedNothingCounted', 'checkFailedTwiceGradingStood', 'replyReplaced', 'frozenAfterCompletion', 'openerCap']);

/** Who shaped what the person saw this turn: the model, plato's instructions, or plato's code. */
function verdictFor(record) {
  if (record.failed) return { source: 'code', text: record.kind === 'profile' ? 'Updating your profile failed. The change to your notes had already been saved.' : 'This attempt failed, so nothing was saved from it.' };
  const types = new Set(record.steps.map((s) => s.type));
  const rules = rulesOf(record.steps).filter((r) => CODE_RULES.has(r));
  if (types.has('replyReplaced') || rules.length) {
    return { source: 'code', text: `plato’s code changed the result: ${rules.length ? rules.map((r) => RULES[r]).join(' ') : RULES.replyReplaced}` };
  }
  if (types.has('heldRewrite') || record.steps.some((s) => ['draftGuard', 'scriptGuard'].includes(s.type) && s.used)) {
    return { source: 'instructions', text: 'plato asked the coach to answer again with an added instruction. What you saw is its second answer.' };
  }
  const repair = record.steps.find((s) => s.type === 'tagRepair' && s.recovered);
  const steering = Object.keys(record.steps.find((s) => s.type === 'context')?.context || {}).filter((k) => CONTEXT_FIELDS[k]?.steers);
  if (repair || steering.length) {
    return { source: 'instructions', text: [
      'The reply you saw is the coach’s own.',
      repair ? 'It left out its tags, so plato asked again for just those.' : null,
      steering.length ? `It followed ${steering.length === 1 ? 'an instruction' : 'instructions'} plato’s code added: ${steering.map((k) => fieldLabel(k).toLowerCase()).join(', ')}.` : null,
    ].filter(Boolean).join(' ') };
  }
  if (record.kind === 'profile') {
    if (types.has('noteScreened')) return { source: 'code', text: 'plato’s code held the note back, so the AI model wasn’t asked and your profile stayed as it was.' };
    if (types.has('profileSaved')) return { source: 'model', text: 'The model rewrote your profile from your note. plato’s code kept your own notes and lesson lists as they were.' };
    return { source: 'code', text: 'Your profile stayed as it was.' };
  }
  if (record.kind === 'followup') return { source: 'model', text: 'A background agent’s output, merged into your saved data by plato’s code.' };
  return { source: 'model', text: 'The reply and score are the model’s own, following plato’s standing instructions. plato’s code changed nothing.' };
}

function titleFor(record) {
  if (record.kind === 'start') return 'Lesson start';
  if (record.kind === 'followup') return `Follow-up: ${agentLabel(record.steps.find((s) => s.type === 'followUpStart')?.agent || '')}`;
  if (record.kind === 'profile') {
    const note = record.steps.find((s) => s.type === 'noteChange');
    return note ? `You ${note.action === 'removed' ? 'removed' : 'added'} a note: “${clip(note.text, 60)}”` : 'A change to your profile notes';
  }
  const input = record.steps.find((s) => s.type === 'input');
  return input?.text ? `Your message: “${clip(input.text, 60)}”` : input?.images?.length ? 'Your message: an image' : 'Your message';
}

/** One recorded step as the view shows it: one step, or two for an AI call. */
function describeSteps(s, ctx) {
  const { history, parts, calls } = ctx;
  const meta = STEPS[s.type] || { title: humanize(s.type), source: 'code', means: '', stage: 'recorded' };
  // A result's agent and check are its call's: the call it names, or in an
  // older trace the latest one before it.
  const call = s.type === 'call' ? s : (s.call != null ? calls.get(s.call) : null);
  const base = (o) => ({
    n: s.n, type: s.type, at: s.ms ?? null,
    stage: meta.stage, source: meta.source, sourceLabel: SOURCES[meta.source].label, means: meta.means,
    rules: [], change: null, note: null, agent: call?.agent || null,
    check: (s.type === 'call' ? s.check || legacyCheck(s) : meta.check) || null,
    raw: { purpose: s.purpose, for: s.for },
    ...o,
    details: (o.details || []).filter((x) => x.text != null && x.text !== ''),
  });
  if (s.type === 'call') {
    const { request, reply, took, agentInfo } = callSteps(s, { history, parts, sameAs: ctx.sameInstructions?.(s), seenMessage: ctx.seenMessage });
    const stage = s.stage || legacyStage(s);
    const note = noteFor(s);
    return [
      base({ ...request, agentInfo, n: `${s.n}a`, part: 'request', stage: stage === 'answered' ? 'prepared' : stage, source: 'code', sourceLabel: SOURCES.code.label, means: STEPS.call.request.means }),
      base({ ...reply, agentInfo, n: `${s.n}b`, part: 'reply', stage, at: s.ms != null && took != null ? s.ms + took : null, took: took ?? null, means: STEPS.call.reply.means, note }),
    ];
  }
  const d = DESCRIBE[s.type]?.(s, ctx) || genericDescription(s);
  return [base({ title: d.title || meta.title, summary: d.summary, hint: d.note || null, rules: d.rules || [], change: d.change || null, details: d.details || [], note: noteFor(s) })];
}

/** A step type this view has no wording for: its recorded fields, labelled. Never a blank. */
function genericDescription(s) {
  const fields = Object.entries(s).filter(([k]) => !['n', 'type', 'ms', 'call'].includes(k));
  return {
    summary: fields.length ? list(fields.slice(0, 4).map(([k, v]) => `${humanize(k).toLowerCase()}: ${clip(typeof v === 'string' ? v : JSON.stringify(v), 40)}`)) + '.' : 'Recorded with no details.',
    details: fields.map(([k, v]) => ({ label: humanize(k), text: pretty(v) })),
  };
}

// Traces recorded before calls named their own stage and check (2026-11-24)
// are placed by agent and purpose.
function legacyStage(s) {
  if (s.agent === 'lesson-owner') return 'setup';
  if (['course-progress-update', 'learner-profile-owner'].includes(s.agent)) return 'background';
  if (s.agent === 'learner-profile-update') return /coach/.test(s.purpose || '') ? 'background' : 'answered';
  if (s.agent === 'coach' && /^(reply|opening message)$/.test(s.purpose || '')) return 'answered';
  return 'checked';
}
function legacyCheck(s) {
  const purpose = s.purpose || '';
  if (s.agent === 'coach' && /for the rewrite|^rewrite: the first reply wrote/.test(purpose)) return 'draft';
  if (s.agent === 'coach' && /^rewrite: the reply mixed/.test(purpose)) return 'language';
  if (s.agent === 'coach' && /^tag repair/.test(purpose)) return 'tags';
  if (['assessor', 'claim-check'].includes(s.agent) || /^rewrite: completion/.test(purpose)) return 'grading';
  return null;
}

const STAGE_ORDER = Object.keys(STAGES);

// Which check a step belongs to (CHECKS): a call names its own, a step type
// names its in STEPS. The tag check of a rewritten reply belongs to the draft
// check that asked for the rewrite.
function checkOf(st) {
  if (st.type === 'tagCheck' && st.raw?.for === 'rewrite') return 'draft';
  return st.check || 'grading';
}

/**
 * "plato checked the answer" as the checks plato runs, in order: each a
 * question, its answer (the first step's sentence), and the steps behind it.
 */
function groupChecks(steps) {
  return Object.keys(CHECKS).map((id) => {
    const mine = steps.filter((st) => checkOf(st) === id);
    if (!mine.length) return null;
    return { id, title: CHECKS[id].title, means: CHECKS[id].means, answer: mine[0], steps: mine.slice(1) };
  }).filter(Boolean);
}

/** What changed, in a few words, for the list of exchanges. */
function headline(record) {
  const applied = record.steps.find((x) => x.type === 'applied');
  if (record.failed) return 'Failed: nothing was saved';
  if (record.kind === 'start') return applied ? `Lesson set up; opening score ${applied.progress ?? 0} of 10` : 'Lesson set up';
  if (applied?.status && applied.status.before !== applied.status.after) return 'Lesson completed';
  if (applied?.progress) return applied.progress.before === applied.progress.after ? `Progress stayed at ${applied.progress.after} of 10` : `Progress ${applied.progress.before} → ${applied.progress.after} of 10`;
  if (record.kind === 'profile') return record.steps.some((x) => x.type === 'profileSaved') ? 'Profile updated' : 'Profile not changed';
  return '';
}

const SHORT_VERDICT = { model: 'The model’s own answer', instructions: 'Shaped by plato’s instructions', code: 'Changed by plato’s code', person: 'Written by a person' };

/**
 * One exchange (a stored turn, plus the background agents it set off) as the
 * view shows it:
 * `{ id, n, kind, at, title, headline, you, saw, firstSeen, verdict, flags,
 *    stages: [{ id, title, means, steps, followups? }] }`.
 */
function describeExchange(rec, followups, { parts, startLesson, prevContext, sameInstructions, seenMessage }) {
  // Rules are worked out from what the turn recorded (deriveRules).
  const derived = deriveRules(rec.steps);
  const record = derived ? { ...rec, steps: rec.steps.map((x) => (x.type === 'applied' ? { ...x, derivedRules: derived } : x)) } : rec;
  const calls = new Map(record.steps.filter((x) => x.type === 'call').map((x) => [x.n, x]));
  const history = record.steps.find((x) => x.type === 'history');
  const input = record.steps.find((x) => ['input', 'noteChange'].includes(x.type));
  const shown = record.steps.find((x) => x.type === 'shown');
  const opener = record.kind === 'start' ? record.steps.find((x) => x.type === 'parsed') : null;
  // The lesson is part of setting it up. On later turns it is noise, unless
  // it was edited after the learner started.
  const lessonNow = record.steps.find((x) => x.type === 'lesson');
  const edited = record.kind === 'turn' && lessonNow && startLesson && lessonNow.updatedAt && startLesson.updatedAt && lessonNow.updatedAt !== startLesson.updatedAt;
  // `history` is shown inside each request; `shown` at the top of the exchange.
  const kept = record.steps.filter((x) => x.type !== 'shown' && x.type !== 'history' && (x.type !== 'lesson' || record.kind === 'start' || edited));
  const saw = shown?.text ?? (record.kind === 'start' ? record.steps.find((x) => x.type === 'parsed')?.text : null);
  const steps = kept.flatMap((x) => describeSteps(x, { history, parts, calls, prevContext, sameInstructions, seenMessage, saw }));
  if (edited) {
    const lesson = steps.find((x) => x.type === 'lesson');
    lesson.stage = 'prepared';
    lesson.title = 'The lesson was edited after you started it';
    lesson.summary = `${lesson.summary} The objectives you’re working to were set when you started; the coach now sees the edited lesson text.`;
    lesson.note = { kind: 'changed', text: 'The lesson was edited after you started it.' };
  }
  const background = followups.map((f) => {
    const fHistory = f.steps.find((x) => x.type === 'history');
    const startStep = f.steps.find((x) => x.type === 'followUpStart');
    return {
      title: agentLabel(startStep?.agent || ''),
      why: startStep?.why || '',
      failed: !!f.failed,
      steps: f.steps.filter((x) => x.type !== 'followUpStart' && x.type !== 'history').flatMap((x) => describeSteps(x, { history: fHistory, parts, calls: new Map(f.steps.filter((y) => y.type === 'call').map((y) => [y.n, y])), sameInstructions, seenMessage })),
    };
  });
  const checks = record.kind === 'turn' ? groupChecks(steps.filter((x) => x.stage === 'checked')) : null;
  const stages = STAGE_ORDER.map((id) => ({
    id, title: STAGES[id].title, means: STAGES[id].means,
    steps: steps.filter((x) => x.stage === id),
    ...(id === 'checked' && checks?.length ? { checks } : {}),
    ...(id === 'background' && background.length ? { followups: background } : {}),
  })).filter((st) => st.steps.length || st.followups);
  const verdict = verdictFor(record);
  const flags = [...flagsFor(record), ...(edited ? [{ id: 'edited', kind: 'changed', text: 'The lesson was edited after you started it.' }] : []), ...followups.flatMap((f) => flagsFor(f))];
  return {
    id: record.at, kind: record.kind, at: record.at, took: record.took, partial: !!record.partial, failed: !!record.failed, app: record.app || {},
    title: titleFor(record), headline: headline(record),
    you: input ? (input.text ?? null) : null,
    saw: shown?.text ?? opener?.text ?? null,
    firstSeen: shown?.replaced ? (shown.firstReply ?? shown.firstStreamed) : null,
    firstSeenLive: shown?.replaced ? shown.streamedLive !== false : false,
    verdict: { ...verdict, lead: verdict.text.match(/^.*?[.!?](?=\s|$)/)?.[0] || verdict.text, sourceLabel: SOURCES[verdict.source].label, short: record.failed ? 'Failed' : SHORT_VERDICT[verdict.source] },
    flags: flags.filter((f, i) => flags.findIndex((g) => g.id === f.id) === i),
    // Where plato stepped in or something went wrong, each with the step it was on.
    interventions: [...steps, ...background.flatMap((f) => f.steps)].filter((x) => x.note).map((x) => ({ n: x.n, kind: x.note.kind, text: x.note.text, stage: x.stage })),
    steppedIn: flags.some((f) => f.kind === 'changed'),
    wentWrong: flags.some((f) => f.kind === 'problem'),
    stages,
    // Every step in order, background agents' included (the download and tests).
    steps: stages.flatMap((st) => [...st.steps, ...(st.followups || []).flatMap((f) => f.steps)]),
  };
}

/**
 * A scope's stored records (`[{ dataKey, data }]` from
 * storage.listTraceRecords) as exchanges, oldest first. Each background
 * agent's record joins the exchange that set it off (the latest turn that
 * started before it).
 */
export function describeTrace(items) {
  const parts = {};
  const turns = [];
  const followups = [];
  for (const { dataKey, data } of items || []) {
    const kind = String(dataKey).split(':')[2];
    if (kind === 'p' && data?.hash) parts[data.hash] = data.text;
    else if (kind === 't' && Array.isArray(data?.steps)) turns.push(data);
    else if (kind === 'b' && Array.isArray(data?.steps)) followups.push(data);
  }
  turns.sort((a, b) => a.at - b.at);
  followups.sort((a, b) => a.at - b.at);
  const startLesson = turns.find((t) => t.kind === 'start')?.steps.find((x) => x.type === 'lesson') || null;
  const owner = (f) => [...turns].reverse().find((t) => t.at <= f.at) || turns[0];
  // A call's instructions, by part: the same text in an earlier exchange is
  // said once ("the same as in exchange 2").
  const firstSeen = new Map();
  let current = 0;
  const sameInstructions = (call) => {
    const sig = `${call.agent}|${call.system.map((p) => p.hash || p.text).join('|')}`;
    if (!firstSeen.has(sig)) { firstSeen.set(sig, current); return null; }
    const at = firstSeen.get(sig);
    return at === current ? null : at;
  };
  const messageFirst = new Map();
  const seenMessage = (text) => {
    if (!messageFirst.has(text)) { messageFirst.set(text, current); return null; }
    const at = messageFirst.get(text);
    return at === current ? null : at;
  };
  let prevContext = null;
  const exchanges = turns.map((t, i) => {
    current = i + 1;
    const e = { ...describeExchange(t, followups.filter((f) => owner(f) === t), { parts, startLesson, prevContext, sameInstructions, seenMessage }), n: i + 1 };
    prevContext = t.steps.find((x) => x.type === 'context')?.context || prevContext;
    return e;
  });
  // Background records with no turn to join (a trace that began mid-way).
  const orphans = turns.length ? [] : followups;
  return {
    exchanges,
    summary: lessonSummary(turns, followups),
    orphans: orphans.map((f) => describeExchange({ ...f, kind: 'followup' }, [], { parts, startLesson })),
    // Where plato stepped in or something went wrong: what the list can narrow to.
    flagged: exchanges.filter((e) => e.steppedIn || e.wentWrong).length,
    partial: exchanges.some((e) => e.partial),
  };
}

/**
 * What plato did across the whole conversation, counted from the records:
 * `[{ id, text, exchanges: [at] }]`, for reading a trace again later. Each
 * entry can narrow the list to the exchanges it counts.
 */
function lessonSummary(turns, followups) {
  const tally = [];
  // `label`: the same, without counts, for "Showing 8 of 11 exchanges: where plato …".
  const add = (id, text, list, label) => { if (list.length) tally.push({ id, text: text(list.length), label, exchanges: list.map((t) => t.at) }); };
  const withStep = (pred) => turns.filter((t) => t.steps.some(pred));
  const repairs = withStep((x) => x.type === 'tagRepair');
  const repairTime = turns.flatMap((t) => t.steps.filter((x) => x.type === 'call' && (x.check === 'tags' || /^tag repair/.test(x.purpose || '')))).reduce((n, x) => n + (x.took || 0), 0);
  add('tags', (n) => `asked the coach again for the tags its reply left out, ${n === 1 ? 'once' : `${n} times`}${repairTime ? ` (${seconds(repairTime)} in all)` : ''}`, repairs, 'asked the coach again for the tags its reply left out');
  add('grading', (n) => `checked the coach’s grading ${n === 1 ? 'once' : `${n} times`}`, withStep((x) => x.type === 'gradingPlan' && x.ran), 'checked the coach’s grading');
  add('held', (n) => `held a completion ${n === 1 ? 'once' : `${n} times`}`, withStep((x) => x.type === 'verdictApplied' && x.held), 'held a completion');
  add('unverified', (n) => `took back an objective the coach checked off ${n === 1 ? 'once' : `${n} times`}`, withStep((x) => x.type === 'verdictApplied' && x.unverified?.length), 'took back an objective the coach checked off');
  add('rewrite', (n) => `asked the coach to rewrite a reply ${n === 1 ? 'once' : `${n} times`}`, withStep((x) => (['draftGuard', 'scriptGuard'].includes(x.type) && x.used) || x.type === 'heldRewrite'), 'asked the coach to rewrite a reply');
  add('replaced', (n) => `replaced the coach’s reply ${n === 1 ? 'once' : `${n} times`}`, withStep((x) => x.type === 'replyReplaced'), 'replaced the coach’s reply');
  for (const k of Object.keys(CONTEXT_FIELDS).filter((key) => CONTEXT_FIELDS[key].steers)) {
    add(k, (n) => `added ${fieldLabel(k).toLowerCase()} for the coach on ${plural(n, 'exchange')}`, withStep((x) => x.type === 'context' && x.context && k in x.context), `added ${fieldLabel(k).toLowerCase()} for the coach`);
  }
  add('wrong', (n) => `ran into a problem on ${plural(n, 'exchange')}`, turns.filter((t) => t.failed || t.steps.some((x) => noteFor(deriveRules(t.steps) && x.type === 'applied' ? { ...x, derivedRules: deriveRules(t.steps) } : x)?.kind === 'problem')), 'ran into a problem');
  return { exchanges: turns.length, followups: followups.length, items: tally };
}

/**
 * The trace as plain text, for downloading and sharing: the same sentences
 * the view shows, in the same order, with the exact text under each step.
 */
export function traceToText(view, { title = 'Trace' } = {}) {
  const out = [title, '='.repeat(title.length), ''];
  if (view.summary?.items?.length) {
    out.push(`Across ${plural(view.summary.exchanges, 'exchange')}, plato:`, ...view.summary.items.map((it) => `- ${it.text}`), '');
  }
  // Long exact text is written once; a repeat says where it first appeared.
  const seen = new Map();
  let at = 0;
  const exact = (text, pad) => {
    const t = String(text);
    if (t.length < 200) return indent(t, pad);
    if (seen.has(t)) return `${pad}      (the same text as in exchange ${seen.get(t)})`;
    seen.set(t, at);
    return indent(t, pad);
  };
  const step = (x, pad) => {
    out.push(`${pad}- ${x.title} [${x.sourceLabel}]`, ...(x.note ? [`${pad}  ! ${x.note.text}`] : []), `${pad}  ${x.summary}`);
    for (const r of x.rules) out.push(`${pad}  Rule: ${r.text}`);
    if (x.change) out.push(`${pad}  Before:`, exact(x.change.before, pad), `${pad}  After:`, exact(x.change.after, pad));
    for (const d of x.details) out.push(`${pad}  ${d.label}:`, exact(d.text, pad));
  };
  for (const e of view.exchanges) {
    at = e.n;
    const head = `${e.n}. ${e.title} · ${new Date(e.at).toISOString()}`;
    out.push(head, '-'.repeat(Math.min(head.length, 80)));
    if (e.you) out.push('You sent:', indent(e.you, ''));
    if (e.saw) out.push('You saw:', indent(e.saw, ''));
    out.push(`${e.verdict.sourceLabel}: ${e.headline ? `${e.headline}. ` : ''}${e.verdict.text}`);
    for (const f of e.interventions || []) out.push(`${f.kind === 'problem' ? 'Went wrong' : 'plato stepped in'}: ${f.text}`);
    out.push('');
    e.stages.forEach((st, i) => {
      out.push(`  ${i + 1}) ${st.title}`);
      for (const x of st.steps) step(x, '    ');
      for (const f of st.followups || []) {
        out.push(`    ${f.title}${f.why ? `, because ${f.why}` : ''}`);
        for (const x of f.steps) step(x, '      ');
      }
    });
    out.push('');
  }
  return out.join('\n');
}
const indent = (text, pad = '') => String(text).split('\n').map((l) => `${pad}      ${l}`).join('\n');

/**
 * "Technology and services": every outside service, what it is sent, and
 * whether this install uses it. `provider` is the server's own account of the
 * model (from a recorded call); `plugins` is the ids of the plugins turned on.
 */
export function technologyFor(items, { plugins = [] } = {}) {
  let provider = null;
  for (const { data } of items || []) {
    for (const s of data?.steps || []) if (s.type === 'call' && s.server?.provider) provider = s.server.provider;
  }
  const on = new Set(plugins);
  return Object.entries(SERVICES).map(([id, svc]) => {
    const inUse = svc.plugin ? on.has(svc.plugin) : true;
    let detail = null;
    if (id === 'model' && provider) detail = provider.provider === 'mock' ? 'This install is using a stand-in model for testing, not a real AI model.' : `This conversation used ${provider.model}.`;
    if (id === 'bedrock' && provider?.region) detail = `Region: ${provider.region}.`;
    return { id, name: svc.name, role: svc.role, sent: svc.sent, note: svc.note || null, when: svc.when, inUse, detail };
  });
}
