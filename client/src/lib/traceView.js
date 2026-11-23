/**
 * Turns stored Trace records (lib/lessonTrace.js) into what the Trace view
 * shows (#595): for each turn, a one-line verdict on who shaped the result,
 * what was unusual, and every step as a plain sentence with the exact
 * text behind it. The wording for agents, steps, rules and sources comes from
 * lib/transparency.js.
 *
 * Pure. Unit tests: client/tests/traceView.test.js.
 */
import { AGENTS, STEPS, STAGES, CHECKS, RULES, SOURCES, PROMPT_PARTS, CONTEXT_FIELDS, EVENTS, SERVICES } from './transparency.js';
import { rebuildRequest } from './lessonTrace.js';
import { LESSON_KB_CHECKS } from '../../js/validators.js';
import { NOTE_RULE_REASONS } from '../../js/learnerNoteFilter.js';

const pretty = (v) => (typeof v === 'string' ? v : JSON.stringify(v, null, 2));
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const clip = (s, n = 90) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const agentLabel = (id) => AGENTS[id]?.label || id;
const seconds = (ms) => (ms == null ? null : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);
const list = (arr) => arr.filter(Boolean).join(', ');

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

const SPEAKER = { user: 'plato / the learner', assistant: 'the model' };
function messagesText(messages) {
  return messages.map((m, i) => `— ${i + 1}. ${SPEAKER[m.role] || m.role} —\n${contentText(m.content)}`).join('\n\n');
}

const chars = (n) => `${Number(n || 0).toLocaleString()} ${n === 1 ? 'character' : 'characters'}`;
const textLength = (content) => (typeof content === 'string' ? content.length : Array.isArray(content) ? content.reduce((n, b) => n + (b.text?.length || b.excerpt?.length || 0), 0) : content?.excerpt?.length || 0);

/**
 * One AI call as two steps: the request (who it was for, what was sent and
 * how big it was) and the reply (what came back, how long it took, why it
 * stopped).
 */
function callSteps(s, { history, parts }) {
  const req = rebuildRequest(s, { history, parts });
  const p = s.server?.provider;
  const where = p ? (p.provider === 'mock' ? 'a stand-in model used for testing' : `${p.model} on Amazon Bedrock${p.region ? ` (${p.region})` : ''}`) : 'the AI model';
  const who = agentLabel(s.agent);
  const instructionChars = s.system.reduce((n, part) => n + (part.chars || 0), 0);
  const messageChars = req.messages.reduce((n, m) => n + textLength(m.content), 0);
  const images = req.messages.reduce((n, m) => n + (Array.isArray(m.content) ? m.content.filter((x) => x.type === 'image').length : 0), 0);
  // A count of 0 means the model didn't report one (the test stand-in never does).
  const tokensIn = s.usage?.input_tokens || null;
  const tokensOut = s.usage?.output_tokens || null;
  const request = {
    title: `Sent to the AI model, for the ${who.toLowerCase()}${s.purpose ? `: ${s.purpose}` : ''}`,
    summary: [
      `plato sent ${where} the ${who.toLowerCase()}’s instructions (${chars(instructionChars)}, in ${plural(s.system.length, 'part')}) and ${plural(req.messages.length, 'message')} (${chars(messageChars)}${images ? `, ${plural(images, 'image')}` : ''}).`,
      tokensIn ? `The model counted it as ${tokensIn.toLocaleString()} tokens.` : null,
      `It allowed a reply of up to ${s.maxTokens.toLocaleString()} tokens${s.temperature != null ? ` at temperature ${s.temperature}` : ''}.`,
      s.attempts?.length ? `The first ${plural(s.attempts.length, 'try', 'tries')} failed and ${s.attempts.length === 1 ? 'was' : 'were'} sent again.` : null,
    ].filter(Boolean).join(' '),
    details: [
      ...s.system.map((part) => ({
        label: `Instructions: ${PROMPT_PARTS[part.kind]?.label || part.kind} (${SOURCES[PROMPT_PARTS[part.kind]?.source]?.label || 'plato'})`,
        note: PROMPT_PARTS[part.kind]?.means,
        text: part.hash ? parts[part.hash] ?? `(${part.chars.toLocaleString()} characters; this part’s text isn’t stored any more)` : part.text,
      })),
      { label: `Messages sent (${req.messages.length})`, text: messagesText(req.messages) },
      { label: 'Settings', text: list([
        `Longest reply allowed: ${s.maxTokens} tokens`,
        s.temperature != null ? `temperature ${s.temperature} (0 means the same input gives the same answer)` : 'temperature: the model’s default',
        s.server?.applied?.dropped?.length ? `fields the server dropped: ${s.server.applied.dropped.join(', ')}` : null,
      ]) },
      ...(s.attempts?.length ? [{ label: `Tries that failed (${s.attempts.length})`, text: s.attempts.map((a) => `${a.type}: ${a.message || ''}${a.server?.limit ? ` (plato’s own limit: ${LIMIT[a.server.limit] || a.server.limit})` : ''}`).join('\n') }] : []),
    ],
  };
  const reply = s.error
    ? {
      title: `The AI model didn’t reply to the ${who.toLowerCase()}`,
      summary: `It failed after ${seconds(s.took) || 'a moment'}: ${s.error.message}`,
      details: [{ label: 'The error', text: pretty(s.error) }],
    }
    : {
      title: `The AI model replied to the ${who.toLowerCase()}`,
      summary: [
        `${chars((s.reply || '').length)}${tokensOut ? ` (${tokensOut.toLocaleString()} tokens)` : ''}, after ${seconds(s.took) || 'a moment'}.`,
        s.stopReason ? `It stopped because ${STOP[s.stopReason] || s.stopReason}.` : null,
        s.server?.attempts > 1 ? `Amazon’s service needed ${s.server.attempts} tries.` : null,
      ].filter(Boolean).join(' '),
      details: [
        ...(s.reply != null ? [{ label: 'The model’s raw reply', text: s.reply }] : []),
        { label: 'The model’s own reasoning', text: s.reasoning || 'None was returned. plato’s model replies without a separate reasoning trace.' },
      ],
    };
  return { request, reply, took: s.took };
}

const STOP = {
  end_turn: 'it had finished',
  max_tokens: 'it reached the longest reply allowed, so the reply was cut off',
  content_filtered: 'a content filter stopped it',
  stop_sequence: 'it reached a stop marker',
};
const LIMIT = { rate: 'more than 30 AI calls in a minute', in_flight: 'more than 4 AI calls at once' };

function saveSentence(s) {
  const what = { lessonKB: 'this lesson’s progress and notes', messages: 'the conversation' }[s.record] || s.record;
  if (s.ok) return `Saved ${what}.${s.conflict ? ' Another device had saved a newer copy first; this one replaced it.' : ''}`;
  const why = s.code === 'too_long' ? 'the conversation is past the size limit' : s.code === 'network' ? 'the network request failed' : s.code || (s.status ? `the server answered ${s.status}` : 'unknown reason');
  return `Saving ${what} failed (${why}). plato tries once more in the background.`;
}

const WHAT = { lesson: 'lesson', knowledgeBase: 'knowledge base' };

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
    summary: `The lesson planner turned the author’s ${plural((s.authorObjectives || []).length, 'objective')} into ${(s.fromModel?.objectives || []).length}, each with what would count as evidence. The coach and the assessment check work from this version.`,
    details: [
      { label: 'Objectives and evidence (the lesson planner’s version)', text: (s.fromModel?.objectives || []).map((o, i) => `${i + 1}. ${o.objective}\n   Evidence: ${o.evidence || '(none given)'}`).join('\n') },
      { label: 'Objectives (the author’s wording)', text: (s.authorObjectives || []).map((o, i) => `${i + 1}. ${o}`).join('\n') },
      ...(s.fromModel?.exemplar && s.fromModel.exemplar !== s.authorExemplar ? [{ label: 'Exemplar (the lesson planner’s copy, which the coach uses)', text: s.fromModel.exemplar }] : []),
      { label: 'Everything the lesson planner returned', text: pretty(s.fromModel) },
    ],
  }),
  validation: (s) => ({
    summary: s.ok && !s.firstError
      ? `plato’s code checked the setup for the ${LESSON_KB_CHECKS.length} things the coach and the assessment check need. All were there.`
      : s.ok
        ? `The first setup was missing something (${s.firstError}), so plato asked the lesson planner again. The second had all ${LESSON_KB_CHECKS.length}.`
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
        ...(s.images || []).map((i, n) => ({ label: `Image ${n + 1}`, text: `${i.type || 'unknown type'}, about ${Math.round((i.chars * 0.75) / 1024)} KB as sent. ${i.sent ? 'Given to the model.' : 'Not given to the model: plato only sends PNG, JPEG, GIF and WebP.'}` })),
        ...(s.links || []).map((l) => ({ label: `Attached page: ${l.title || l.url}`, text: `${l.url}${l.finalUrl ? `\n(redirected to ${l.finalUrl})` : ''}\n${l.chars.toLocaleString()} characters of page text were given to the model${l.truncated ? ' (the page was longer and was cut)' : ''}.` })),
      ],
    };
  },
  state: (s) => ({
    summary: `Before this message: progress ${s.progress} of 10, ${plural(s.objectivesMet.length, 'objective')} checked off, ${plural(s.activitiesCompleted, 'exchange')} so far${s.status === 'completed' ? ', lesson already complete' : ''}.`,
  }),
  tail: (s) => ({
    summary: `${plural(s.sent, 'earlier message')} sent as the conversation so far.${s.olderLeftOut ? ` ${plural(s.olderLeftOut, 'older message')} left out (only the last 40 are sent).` : ''}${s.earlierImages || s.earlierLinks ? ` Images and attached pages from earlier messages aren’t sent again, so the coach can’t see them now.` : ''}`,
  }),
  context: (s) => ({
    summary: `plato’s code gathered ${plural(Object.keys(s.context).length, 'thing')} about you and the lesson for the coach.`,
    details: Object.entries(s.context).map(([k, v]) => ({
      label: `${CONTEXT_FIELDS[k]?.label || k} (${SOURCES[CONTEXT_FIELDS[k]?.source]?.label || 'plato'})`,
      note: CONTEXT_FIELDS[k]?.from,
      text: pretty(v),
    })),
  }),
  history: (s) => ({
    summary: `${plural(s.messages.length, 'message')}: what plato gathered, a fixed “Ready.”, the conversation so far, and this message.`,
    details: [{ label: 'The messages', text: messagesText(s.messages) }],
  }),
  parsed: (s) => ({
    summary: list([
      s.progress != null ? `Progress score: ${s.progress} of 10` : 'No progress score in the reply',
      s.kbUpdate?.objectivesMet?.length ? `objectives it says are met: ${s.kbUpdate.objectivesMet.join(', ')}` : null,
      s.kbUpdate?.insights?.length ? plural(s.kbUpdate.insights.length, 'note') : null,
      s.profileUpdate?.observation ? 'an observation for your profile' : null,
    ]) + '.',
    details: [
      { label: 'The reply with its tags, as the model wrote it', text: s.raw },
      { label: 'The text shown to you', text: s.text },
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
  }),
  tagRepair: (s) => ({
    summary: s.recovered ? 'plato asked the coach for the tags of the reply it had given, and got them.' : 'plato asked the coach for the missing tags and still didn’t get them all, so nothing was recorded for what was missing.',
    details: [{ label: 'What came back', text: pretty({ progress: s.progress, notes: s.kbUpdate, profile: s.profileUpdate }) }],
  }),
  draftGuard: (s) => ({
    summary: s.failed ? `plato asked for a rewrite, which failed (${s.failed}), so the first reply was kept.` : s.used ? `plato showed the rewrite in place of the first reply.${s.stillDrafts ? ' The rewrite still drafted an answer.' : ''}` : 'The rewrite came back empty, so the first reply was kept.',
    change: s.after ? { before: s.before, after: s.after } : null,
  }),
  gradingPlan: (s) => ({
    summary: !s.ran ? 'Not needed: the coach didn’t check off a new objective or score 10.' : `The coach ${s.completionClaimed ? 'scored 10' : 'checked off an objective'}, so plato checked ${plural(s.check.length, 'objective')}: ${s.check.join(', ')}.`,
  }),
  gradingRetry: (s) => ({ summary: `The assessment check’s first answer couldn’t be read (${s.why}); plato asked again.` }),
  verdict: (s) => ({
    summary: `Shown in your own words: ${s.shown.length ? s.shown.join(', ') : 'none'}. Not shown: ${Object.keys(s.missing).length ? Object.keys(s.missing).join(', ') : 'none'}.`,
    details: [
      ...Object.entries(s.evidence || {}).map(([n, quotes]) => ({
        label: `Objective ${n}: the quotes it relied on`,
        text: quotes.map((q) => `“${q.quote}”\n  ${q.ok ? `Found in your message (message ${q.learnerAt + 1} of the conversation it read).` : q.coachAt !== -1 ? `The coach wrote this first (message ${q.coachAt + 1}), so it doesn’t count as yours.` : 'Not found in anything you wrote.'}`).join('\n\n'),
      })),
      ...Object.entries(s.missing).map(([n, why]) => ({ label: `Objective ${n}: why it didn’t count`, text: String(why) })),
      { label: 'The assessment check’s full answer', text: pretty(s.verdict) },
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
        : `plato’s code found none of the wording it knows means “done”, so it asked the completion wording check, an AI helper, for a yes or no: ${s.byModel === 'failed' ? 'that failed, so the reply was kept' : s.byModel ? 'yes' : 'no'}.`,
      s.saysDone ? 'So the reply was replaced.' : 'So the reply was kept.',
    ].join(' '),
  }),
  replyReplaced: (s) => ({ summary: 'The coach’s reply said the lesson was done while completion was held. plato’s code showed a standard message instead.', change: { before: s.before, after: s.after } }),
  positionReplaced: (s) => ({ summary: 'The coach’s “Where you are” note said the lesson was done while completion was held. plato’s code replaced it.', change: { before: s.before, after: s.after } }),
  applied: (s) => ({
    summary: s.opener
      ? `Opening score: ${s.progress ?? 0} of 10.`
      : `Progress ${s.progress.before} → ${s.progress.after} of 10. Objectives checked off: ${s.objectivesMet.after.length} of ${s.objectivesMet.total}.${s.status.before !== s.status.after ? ' The lesson was marked complete.' : ''}`,
    rules: (s.rules || []).map((id) => ({ id, text: RULES[id] || id })),
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
      ? `The removed note had been held back from the learner profile agent, because ${why}. There was nothing to undo.`
      : `plato’s code didn’t give this note to the learner profile agent, because ${why}. Notes describe you; they can’t give the AI orders. The note itself is still saved, and you can remove it.` };
  },
  profileSaved: (s) => ({
    summary: (() => {
      const changed = ['name', 'goal', 'strengths', 'weaknesses', 'preferences'].filter((k) => JSON.stringify(s.before?.[k] ?? null) !== JSON.stringify(s.after?.[k] ?? null));
      return [
        changed.length ? `The learner profile agent changed: ${changed.join(', ')}.` : 'The learner profile agent changed none of the profile’s fields.',
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
  authorInput: (s) => ({ summary: `You wrote: “${clip(s.text, 120)}”.`, details: [{ label: 'Your message', text: s.text }] }),
  authoringOpened: (s) => ({
    summary: s.resumed ? 'plato’s code sent the saved conversation so the agent could reply to its last message.' : 'plato’s code sent a fixed first message so the agent could open the conversation.',
    details: [{ label: s.resumed ? 'The last message sent' : 'The first message', text: s.opening }],
  }),
  authoringTail: (s) => ({
    summary: `${plural(s.sent, 'message')} sent to the agent.${s.olderLeftOut ? ` ${plural(s.olderLeftOut, 'older message')} left out (only the last 15 are sent).` : ''}`,
  }),
  authoringParsed: (s) => ({
    summary: s.readiness != null
      ? `Readiness score: ${s.readiness} of 10${s.readinessBefore != null && s.readinessBefore !== s.readiness ? ` (it was ${s.readinessBefore})` : ''}. plato’s code took the score off the text you were shown.`
      : 'The reply had no readiness score, so the readiness bar stayed where it was.',
    details: [
      { label: 'The reply with its score, as the model wrote it', text: s.raw },
      { label: 'The text shown to you', text: s.text },
    ],
  }),
  extractAsked: (s) => ({
    summary: `You asked plato to write the ${WHAT[s.what] || s.what} from the conversation${s.messages != null ? ` (${plural(s.messages, 'message')})` : ''}, ${s.why === 'save' ? 'and save it' : 'for the preview'}.`,
  }),
  extracted: (s) => ({
    summary: s.problem
      ? `The model wrote ${plural((s.markdown || '').length, 'character')}, but plato’s code couldn’t use it: ${s.problem} Nothing was saved.`
      : `The model wrote the ${WHAT[s.what] || s.what} (${plural((s.markdown || '').length, 'character')}). ${s.use === 'save' ? 'plato’s code found it complete and went on to save it.' : 'It was shown in the preview and not saved.'}`,
    details: [{ label: `The ${WHAT[s.what] || s.what} as written`, text: s.markdown || '(nothing)' }],
  }),
  authoringSaved: (s) => ({ summary: s.ok ? `The ${WHAT[s.what] || s.what} was saved.` : `Saving the ${WHAT[s.what] || s.what} failed (${s.why || 'unknown reason'}).` }),
  shown: (s) => ({
    summary: s.replaced ? 'You watched a first reply arrive, and then it was replaced by the one below.' : 'The reply you saw is the one the model wrote.',
    change: s.replaced ? { before: s.firstStreamed, after: s.text } : null,
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
    case 'validation': return s.firstError ? problem(s.ok ? 'The lesson planner’s first setup was incomplete, so plato asked again.' : 'The lesson planner’s setup was incomplete, and was used anyway so the lesson could start.') : null;
    case 'plugins': return s.failed ? problem('Plugins couldn’t be asked for background, so the lesson started without it.') : null;
    case 'tagCheck': return s.progress && s.notes ? null : changed('the score and notes recorded for this reply came from a second request, not from the reply itself.');
    case 'tagRepair': return s.recovered ? null : problem('The tags couldn’t be recovered, so nothing from this reply was recorded.');
    case 'draftCheck': return s.drafts ? changed('plato asked the coach to rewrite this reply.') : null;
    case 'gradingFailed': return problem('The assessment check couldn’t run, so nothing new was checked off this time.');
    case 'gradingStood': return changed('plato accepted the coach’s grading without the check, so you weren’t stuck.');
    case 'verdictApplied':
      if (s.held) return changed('plato held the lesson open: the coach scored 10, but not every objective was shown in your own words.');
      if (s.unverified?.length) return changed('plato took back an objective the coach checked off, because it wasn’t in your own words.');
      return null;
    case 'replyReplaced': return changed('plato replaced the coach’s reply with a standard message: what you saw isn’t what the model wrote.');
    case 'positionReplaced': return changed('plato replaced the coach’s “Where you are” note.');
    case 'applied':
      if (s.rules?.includes('cappedAt9')) return changed('plato’s code changed your score: the coach gave 10, but it was recorded as 9 because not every objective was checked off.');
      if (s.rules?.includes('noProgressTag')) return problem('The reply had no progress score, so your score didn’t change.');
      return null;
    case 'save':
      if (!s.ok) return problem(saveSentence(s));
      if (s.conflict) return problem('Another device had saved a newer copy of this lesson; this one replaced it.');
      return null;
    case 'profileUnchanged': case 'unitNoteUnchanged': return problem(DESCRIBE[s.type](s).summary);
    case 'noteScreened': return changed('plato held this note back from the AI model.');
    case 'extracted': return s.problem ? problem(`What the model wrote couldn’t be used: ${s.problem}`) : null;
    case 'authoringSaved': return s.ok ? null : problem(DESCRIBE.authoringSaved(s).summary);
    default: return null;
  }
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
  const rules = record.steps.filter((s) => s.type === 'applied').flatMap((s) => s.rules || []).filter((r) => CODE_RULES.has(r));
  if (types.has('replyReplaced') || rules.length) {
    return { source: 'code', text: `plato’s code changed the result: ${rules.length ? rules.map((r) => RULES[r]).join(' ') : RULES.replyReplaced}` };
  }
  if (types.has('heldRewrite') || [...record.steps].some((s) => (s.type === 'draftGuard' && s.used) || s.type === 'tagRepair')) {
    return { source: 'instructions', text: 'plato asked the model to answer again with an added instruction. The reply and score are the model’s second answer.' };
  }
  if (record.kind === 'profile') {
    if (types.has('noteScreened')) return { source: 'code', text: 'plato’s code held the note back, so the AI model wasn’t asked and your profile stayed as it was.' };
    if (types.has('profileSaved')) return { source: 'model', text: 'The model rewrote your profile from your note. plato’s code kept your own notes and lesson lists as they were.' };
    return { source: 'code', text: 'Your profile stayed as it was.' };
  }
  if (record.kind === 'authoring') {
    const written = record.steps.find((s) => s.type === 'extracted');
    if (written?.problem) return { source: 'code', text: 'The model wrote the text, and plato’s code found it incomplete, so it wasn’t used.' };
    if (written) return { source: 'model', text: `The text is the model’s own, written from the conversation. plato’s code checked it${written.use === 'save' ? ' and saved it' : ' and showed it in the preview'}.` };
    return { source: 'model', text: 'The reply and its readiness score are the model’s own, following plato’s standing instructions. plato’s code only took the score off the text shown.' };
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
  if (record.kind === 'authoring') {
    const asked = record.steps.find((s) => s.type === 'extractAsked');
    if (asked) return `${asked.why === 'save' ? 'Save' : 'Preview'}: writing the ${WHAT[asked.what] || asked.what}`;
    const wrote = record.steps.find((s) => s.type === 'authorInput');
    return wrote ? `Your message: “${clip(wrote.text, 60)}”` : 'Conversation start';
  }
  const input = record.steps.find((s) => s.type === 'input');
  return input?.text ? `Your message: “${clip(input.text, 60)}”` : input?.images?.length ? 'Your message: an image' : 'Your message';
}

// Which agent a step is about, so the view can say who that is the first
// time it comes up.
const STEP_AGENT = {
  planned: 'lesson-owner', validation: 'lesson-owner',
  gradingPlan: 'assessor', gradingRetry: 'assessor', verdict: 'assessor', recheck: 'assessor', gradingFailed: 'assessor', gradingStood: 'assessor', verdictApplied: 'assessor',
  claimCheck: 'claim-check', tagCheck: 'coach', tagRepair: 'coach', draftCheck: 'coach', draftGuard: 'coach', heldRewrite: 'coach', parsed: 'coach',
};

/** One recorded step as the view shows it: one step, or two for an AI call. */
function describeSteps(s, { history, parts }) {
  const meta = STEPS[s.type] || { title: s.type, source: 'code', means: '', stage: 'recorded' };
  const base = (o) => ({
    n: s.n, type: s.type, at: s.ms ?? null,
    stage: meta.stage, source: meta.source, sourceLabel: SOURCES[meta.source].label, means: meta.means,
    rules: [], change: null, note: null, agent: STEP_AGENT[s.type] || s.agent || null,
    raw: { purpose: s.purpose, for: s.for },
    ...o,
    details: (o.details || []).filter((x) => x.text != null && x.text !== ''),
  });
  if (s.type === 'call') {
    const { request, reply, took } = callSteps(s, { history, parts });
    const stage = callStage(s);
    const note = noteFor(s);
    return [
      base({ ...request, n: `${s.n}a`, part: 'request', stage: stage === 'answered' ? 'prepared' : stage, source: 'code', sourceLabel: SOURCES.code.label, means: STEPS.call.request.means }),
      base({ ...reply, n: `${s.n}b`, part: 'reply', stage, at: s.ms != null && took != null ? s.ms + took : null, took: took ?? null, means: STEPS.call.reply.means, note }),
    ];
  }
  const d = DESCRIBE[s.type]?.(s) || { summary: '' };
  return [base({ title: d.title || meta.title, summary: d.summary, rules: d.rules || [], change: d.change || null, details: d.details || [], note: noteFor(s) })];
}

/** The first time each agent comes up in an exchange, say who it is. */
function explainAgents(steps) {
  const seen = new Set();
  for (const st of steps) {
    if (!st.agent || seen.has(st.agent) || !AGENTS[st.agent]) continue;
    seen.add(st.agent);
    st.explain = { label: AGENTS[st.agent].label, text: `${AGENTS[st.agent].label} is one of plato’s AI helpers (the same AI model, with its own instructions). ${AGENTS[st.agent].purpose}` };
  }
  return steps;
}

// The model call that produces the answer belongs to "answered"; every other
// call is plato checking, setting up, or working in the background.
function callStage(s) {
  if (s.agent === 'lesson-owner') return 'setup';
  if (['course-progress-update', 'learner-profile-owner'].includes(s.agent)) return 'background';
  if (s.agent === 'learner-profile-update') return /coach/.test(s.purpose || '') ? 'background' : 'answered';
  if (['lesson-creator', 'knowledge-base-editor', 'lesson-extractor', 'knowledge-base-extractor'].includes(s.agent)) return 'answered';
  if (s.agent === 'coach' && /^(reply|opening message)$/.test(s.purpose || '')) return 'answered';
  return 'checked';
}

const STAGE_ORDER = Object.keys(STAGES);

// Which check a step belongs to (CHECKS). Tag repair for a rewritten reply
// belongs to the draft check that asked for the rewrite.
function checkOf(st) {
  const purpose = st.raw?.purpose || '';
  if (st.type === 'tagCheck' || st.type === 'tagRepair') return st.raw?.for === 'rewrite' ? 'draft' : 'tags';
  if (st.type === 'call' && /^tag repair, for the rewrite/.test(purpose)) return 'draft';
  if (st.type === 'call' && /^tag repair/.test(purpose)) return 'tags';
  if (st.type === 'draftCheck' || st.type === 'draftGuard') return 'draft';
  if (st.type === 'call' && /^rewrite: the first reply wrote/.test(purpose)) return 'draft';
  return 'grading';
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
  if (record.kind === 'authoring') {
    const r = record.steps.find((x) => x.type === 'authoringParsed');
    if (r?.readiness != null) return `Readiness ${r.readiness} of 10`;
    const saved = record.steps.find((x) => x.type === 'authoringSaved');
    if (saved) return saved.ok ? 'Saved' : 'Not saved';
  }
  return '';
}

const SHORT_VERDICT = { model: 'The model’s own answer', instructions: 'Shaped by plato’s instructions', code: 'Changed by plato’s code', person: 'Written by a person' };

/**
 * One exchange (a stored turn, plus the background agents it set off) as the
 * view shows it:
 * `{ id, n, kind, at, title, headline, you, saw, firstSeen, verdict, flags,
 *    stages: [{ id, title, means, steps, followups? }] }`.
 */
function describeExchange(record, followups, { parts, startLesson }) {
  const history = record.steps.find((x) => x.type === 'history');
  const input = record.steps.find((x) => ['input', 'authorInput', 'noteChange'].includes(x.type));
  const shown = record.steps.find((x) => x.type === 'shown');
  const opener = record.kind === 'start' ? record.steps.find((x) => x.type === 'parsed') : null;
  const authored = record.steps.find((x) => x.type === 'authoringParsed');
  // The lesson is part of setting it up. On later turns it is noise, unless
  // it was edited after the learner started.
  const lessonNow = record.steps.find((x) => x.type === 'lesson');
  const edited = record.kind === 'turn' && lessonNow && startLesson && lessonNow.updatedAt && startLesson.updatedAt && lessonNow.updatedAt !== startLesson.updatedAt;
  // `history` is shown inside each request; `shown` at the top of the exchange.
  const kept = record.steps.filter((x) => x.type !== 'shown' && x.type !== 'history' && (x.type !== 'lesson' || record.kind === 'start' || edited));
  const steps = kept.flatMap((x) => describeSteps(x, { history, parts }));
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
      steps: f.steps.filter((x) => x.type !== 'followUpStart' && x.type !== 'history').flatMap((x) => describeSteps(x, { history: fHistory, parts })),
    };
  });
  explainAgents([...steps, ...background.flatMap((f) => f.steps)]);
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
    saw: shown?.text ?? opener?.text ?? authored?.text ?? null,
    firstSeen: shown?.replaced ? shown.firstStreamed : null,
    verdict: { ...verdict, sourceLabel: SOURCES[verdict.source].label, short: record.failed ? 'Failed' : SHORT_VERDICT[verdict.source] },
    flags: flags.filter((f, i) => flags.findIndex((g) => g.id === f.id) === i),
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
  const exchanges = turns.map((t, i) => ({
    ...describeExchange(t, followups.filter((f) => owner(f) === t), { parts, startLesson }),
    n: i + 1,
  }));
  // Background records with no turn to join (a trace that began mid-way).
  const orphans = turns.length ? [] : followups;
  return {
    exchanges,
    orphans: orphans.map((f) => describeExchange({ ...f, kind: 'followup' }, [], { parts, startLesson })),
    // Where plato stepped in or something went wrong: what the list can narrow to.
    flagged: exchanges.filter((e) => e.steppedIn || e.wentWrong).length,
    partial: exchanges.some((e) => e.partial),
  };
}

/**
 * The trace as plain text, for downloading and sharing: the same sentences
 * the view shows, in the same order, with the exact text under each step.
 */
export function traceToText(view, { title = 'Trace' } = {}) {
  const out = [title, '='.repeat(title.length), ''];
  const step = (x, pad) => {
    out.push(`${pad}- ${x.title} [${x.sourceLabel}]`, ...(x.note ? [`${pad}  ! ${x.note.text}`] : []), `${pad}  ${x.summary}`);
    for (const r of x.rules) out.push(`${pad}  Rule: ${r.text}`);
    if (x.change) out.push(`${pad}  Before:`, indent(x.change.before, pad), `${pad}  After:`, indent(x.change.after, pad));
    for (const d of x.details) out.push(`${pad}  ${d.label}:`, indent(d.text, pad));
  };
  for (const e of view.exchanges) {
    const head = `${e.n}. ${e.title} · ${new Date(e.at).toISOString()}`;
    out.push(head, '-'.repeat(Math.min(head.length, 80)));
    if (e.you) out.push('You sent:', indent(e.you, ''));
    if (e.saw) out.push('You saw:', indent(e.saw, ''));
    out.push(`${e.verdict.sourceLabel}: ${e.verdict.text}`);
    for (const f of e.flags) out.push(`${f.kind === 'problem' ? 'Went wrong' : f.kind === 'changed' ? 'plato stepped in' : 'Note'}: ${f.text}`);
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
