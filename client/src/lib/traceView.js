/**
 * Turns stored Trace records (lib/lessonTrace.js) into what the Trace view
 * shows (#595): for each turn, a one-line verdict on who shaped the result,
 * the things worth a look, and every step as a plain sentence with the exact
 * text behind it. The wording for agents, steps, rules and sources comes from
 * lib/transparency.js.
 *
 * Pure. Unit tests: client/tests/traceView.test.js.
 */
import { AGENTS, STEPS, RULES, SOURCES, PROMPT_PARTS, CONTEXT_FIELDS, EVENTS } from './transparency.js';
import { rebuildRequest } from './lessonTrace.js';

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

/** One AI call: who, why, what it was given, what came back. */
function callStep(s, { history, parts }) {
  const req = rebuildRequest(s, { history, parts });
  const p = s.server?.provider;
  const where = p ? (p.provider === 'mock' ? 'a stand-in model used for testing' : `${p.model} on Amazon Bedrock${p.region ? ` (${p.region})` : ''}`) : 'the AI model';
  const outcome = s.error
    ? `It failed: ${s.error.message}`
    : `${s.usage ? `${plural(s.usage.input_tokens, 'token')} in, ${s.usage.output_tokens} out. ` : ''}${s.took != null ? `Took ${seconds(s.took)}.` : ''}`;
  const details = [
    ...s.system.map((part) => ({
      label: `Instructions: ${PROMPT_PARTS[part.kind]?.label || part.kind} (${SOURCES[PROMPT_PARTS[part.kind]?.source]?.label || 'plato'})`,
      note: PROMPT_PARTS[part.kind]?.means,
      text: part.hash ? parts[part.hash] ?? `(${part.chars.toLocaleString()} characters; this part’s text isn’t stored any more)` : part.text,
      ...(part.cut ? { cut: true } : {}),
    })),
    { label: `Messages sent (${req.messages.length})`, text: messagesText(req.messages) },
    ...(s.reply != null ? [{ label: 'The model’s raw reply', text: s.reply }] : []),
    { label: 'The model’s own reasoning', text: s.reasoning || 'None was returned. plato’s model replies without a separate reasoning trace.' },
    { label: 'Settings', text: list([
      `Longest reply allowed: ${s.maxTokens} tokens`,
      s.temperature != null ? `temperature ${s.temperature} (0 means the same input gives the same answer)` : 'temperature: the model’s default',
      s.stopReason ? `why it stopped: ${STOP[s.stopReason] || s.stopReason}` : null,
      s.server?.attempts > 1 ? `the server tried ${s.server.attempts} times` : null,
      s.server?.applied?.dropped?.length ? `fields the server dropped: ${s.server.applied.dropped.join(', ')}` : null,
    ]) },
    ...(s.attempts?.length ? [{ label: `Earlier tries that failed (${s.attempts.length})`, text: s.attempts.map((a) => `${a.type}: ${a.message || ''}${a.server?.limit ? ` (plato’s own limit: ${LIMIT[a.server.limit] || a.server.limit})` : ''}`).join('\n') }] : []),
    ...(s.error ? [{ label: 'The error', text: pretty(s.error) }] : []),
  ];
  return {
    title: `${agentLabel(s.agent)}${s.purpose ? `: ${s.purpose}` : ''}`,
    summary: `plato sent ${where} the ${agentLabel(s.agent).toLowerCase()}’s instructions and ${plural(req.messages.length, 'message')}. ${outcome}`.trim(),
    details,
  };
}

const STOP = {
  end_turn: 'it finished',
  max_tokens: 'it ran out of room (the reply was cut off)',
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

function objectiveList(nums, objectives = []) {
  return (nums || []).map((n) => `${n}. ${objectives[n - 1]?.objective || objectives[n - 1] || ''}`.trim()).join('\n') || 'none';
}

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
    summary: `The planner turned the author’s ${plural((s.authorObjectives || []).length, 'objective')} into ${(s.fromModel?.objectives || []).length}, each with what would count as evidence.`,
    details: [
      { label: 'Objectives and evidence (the planner’s version)', text: (s.fromModel?.objectives || []).map((o, i) => `${i + 1}. ${o.objective}\n   Evidence: ${o.evidence || '(none given)'}`).join('\n') },
      { label: 'Objectives (the author’s wording)', text: (s.authorObjectives || []).map((o, i) => `${i + 1}. ${o}`).join('\n') },
      ...(s.fromModel?.exemplar && s.fromModel.exemplar !== s.authorExemplar ? [{ label: 'Exemplar (the planner’s copy, which the coach uses)', text: s.fromModel.exemplar }] : []),
      { label: 'Everything the planner returned', text: pretty(s.fromModel) },
    ],
  }),
  validation: (s) => ({
    summary: s.ok && !s.firstError ? 'The setup had the right shape.' : s.ok ? `The first setup wasn’t valid (${s.firstError}); the second was.` : `The first setup wasn’t valid (${s.firstError}), and neither was the second (${s.secondError}). It was used anyway.`,
  }),
  plugins: (s) => ({
    summary: s.failed ? `Asking plugins for background failed (${s.failed}); the lesson started without it.` : s.enrichments?.length ? `${plural(s.enrichments.length, 'plugin')} added background for the coach: ${s.enrichments.map((e) => e.label || e.pluginId).join(', ')}.` : 'No plugin added anything.',
    details: (s.enrichments || []).flatMap((e) => [
      { label: `${e.label || e.pluginId}: what it gave the coach`, text: e.context || '(nothing)' },
      { label: `${e.label || e.pluginId}: why`, text: e.reasoning || '(not given)' },
      ...(e.sources?.length ? [{ label: `${e.label || e.pluginId}: sources`, text: e.sources.map((x) => `${x.title || x.url}\n${x.url}`).join('\n\n') }] : []),
    ]),
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
    summary: s.saysDone ? `Yes${s.byPattern ? ' (it used wording plato recognises)' : ' (the model judged that it did)'}.` : `No${s.byModel === 'failed' ? ' (the model check failed, so the reply was kept)' : ''}.`,
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
  noteScreened: () => ({ summary: 'The note read like an instruction, so it wasn’t given to the agent. The note itself is still saved and you can remove it.' }),
  profileSaved: (s) => ({
    summary: `Your profile was updated${s.summary ? ' and its summary rewritten' : ''}.`,
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
  shown: (s) => ({
    summary: s.replaced ? 'You watched a first reply arrive, and then it was replaced by the one below.' : 'The reply you saw is the one the model wrote.',
    change: s.replaced ? { before: s.firstStreamed, after: s.text } : null,
    details: s.replaced ? [] : [{ label: 'The reply', text: s.text }],
  }),
  error: (s) => ({ summary: `${s.error.message}${s.error.type ? ` (${s.error.type})` : ''}`, details: [{ label: 'The error', text: pretty(s.error) }] }),
};

/** Things worth a look in one turn: `[{ id, text }]`. */
function flagsFor(record) {
  const flags = [];
  const add = (id, text) => { if (!flags.some((f) => f.id === id)) flags.push({ id, text }); };
  if (record.partial && record.kind === 'turn') add('partial', 'Recording began partway through this lesson; earlier messages weren’t recorded.');
  for (const s of record.steps) {
    if (s.type === 'error') add('failed', `This attempt failed: ${s.error.message}`);
    if (s.type === 'call') {
      if (s.stopReason === 'max_tokens') add('cutOff', `${agentLabel(s.agent)}’s reply was cut off (it ran out of room).`);
      if (s.stopReason === 'content_filtered') add('filtered', `A content filter stopped ${agentLabel(s.agent).toLowerCase()}’s reply.`);
      if (s.attempts?.length) add('retried', 'The AI service was busy; plato tried again.');
      if (s.error && s.agent !== 'coach') add(`error-${s.agent}`, `${agentLabel(s.agent)} failed: ${s.error.message}`);
    }
    if (s.type === 'input' && s.images?.some((i) => !i.sent)) add('imageNotSent', 'An image you attached wasn’t given to the model.');
    if (s.type === 'validation' && s.firstError) add('validation', s.ok ? 'The lesson planner’s first setup wasn’t valid; the second was.' : 'The lesson planner’s setup wasn’t valid, and was used anyway.');
    if (s.type === 'plugins' && s.failed) add('plugins', 'Plugins couldn’t be asked for background.');
    if (s.type === 'tagRepair') add('tags', s.recovered ? 'The coach’s reply was missing its tags; plato asked for them.' : 'The coach’s reply was missing its tags and they couldn’t be recovered, so progress wasn’t recorded for it.');
    if (s.type === 'draftGuard' && s.used) add('draft', 'The coach drafted your answer for you; plato asked it to rewrite the reply.');
    if (s.type === 'gradingFailed') add('checkFailed', 'The assessment check couldn’t run, so nothing new was checked off.');
    if (s.type === 'gradingStood') add('checkStood', 'The assessment check failed twice running; the coach’s grading was accepted.');
    if (s.type === 'verdictApplied' && s.held) add('held', 'The coach scored 10, but completion was held: not every objective was shown in your own words.');
    if (s.type === 'verdictApplied' && s.unverified.length) add('unverified', 'An objective the coach checked off wasn’t backed up by your own words.');
    if (s.type === 'replyReplaced') add('replaced', 'plato’s code replaced the coach’s reply with a standard message.');
    if (s.type === 'applied' && s.rules?.includes('cappedAt9')) add('capped', 'The coach scored 10; plato’s code recorded 9 because not every objective was checked off.');
    if (s.type === 'applied' && s.rules?.includes('noProgressTag')) add('noScore', 'The reply had no progress score, so the score didn’t change.');
    if (s.type === 'save' && !s.ok) add(`save-${s.record}`, saveSentence(s));
    if (s.type === 'save' && s.conflict && s.ok) add('conflict', 'Another device had saved a newer copy of this lesson; this turn replaced it.');
    if (s.type === 'profileUnchanged' || s.type === 'unitNoteUnchanged') add(s.type, DESCRIBE[s.type](s).summary);
  }
  return flags;
}

const CODE_RULES = new Set(['cappedAt9', 'heldAt8', 'clamped', 'objectivesNotBackedUp', 'checkFailedNothingCounted', 'checkFailedTwiceGradingStood', 'replyReplaced', 'frozenAfterCompletion', 'openerCap']);

/** Who shaped what the person saw this turn: the model, plato's instructions, or plato's code. */
function verdictFor(record) {
  if (record.failed) return { source: 'code', text: 'This attempt failed, so nothing was saved from it.' };
  const types = new Set(record.steps.map((s) => s.type));
  const rules = record.steps.filter((s) => s.type === 'applied').flatMap((s) => s.rules || []).filter((r) => CODE_RULES.has(r));
  if (types.has('replyReplaced') || rules.length) {
    return { source: 'code', text: `plato’s code changed the result: ${rules.length ? rules.map((r) => RULES[r]).join(' ') : RULES.replyReplaced}` };
  }
  if (types.has('heldRewrite') || [...record.steps].some((s) => (s.type === 'draftGuard' && s.used) || s.type === 'tagRepair')) {
    return { source: 'instructions', text: 'plato asked the model to answer again with an added instruction. The reply and score are the model’s second answer.' };
  }
  if (record.kind === 'followup') return { source: 'model', text: 'A background agent’s output, merged into your saved data by plato’s code.' };
  return { source: 'model', text: 'The reply and score are the model’s own, following plato’s standing instructions. plato’s code changed nothing.' };
}

function titleFor(record) {
  if (record.kind === 'start') return 'Lesson start';
  if (record.kind === 'followup') return `Follow-up: ${agentLabel(record.steps.find((s) => s.type === 'followUpStart')?.agent || '')}`;
  const input = record.steps.find((s) => s.type === 'input');
  return input?.text ? `Your message: “${clip(input.text, 60)}”` : input?.images?.length ? 'Your message: an image' : 'Your message';
}

/**
 * One record as the view shows it.
 * `{ id, kind, title, at, took, partial, failed, app, verdict, flags, steps }`
 * where each step is `{ n, type, title, source, sourceLabel, means, summary,
 * rules?, change?, details: [{ label, note?, text }] }`.
 */
export function describeRecord(record, { parts = {} } = {}) {
  const history = record.steps.find((s) => s.type === 'history');
  const steps = record.steps.map((s) => {
    const meta = STEPS[s.type] || { title: s.type, source: 'code', means: '' };
    const d = s.type === 'call' ? callStep(s, { history, parts }) : (DESCRIBE[s.type]?.(s) || { summary: '' });
    return {
      n: s.n, type: s.type, ms: s.ms,
      title: d.title || meta.title,
      source: meta.source, sourceLabel: SOURCES[meta.source].label, means: meta.means,
      summary: d.summary, rules: d.rules || [], change: d.change || null, details: (d.details || []).filter((x) => x.text != null && x.text !== ''),
    };
  });
  return {
    id: record.at, kind: record.kind, title: titleFor(record), at: record.at, took: record.took,
    partial: !!record.partial, failed: !!record.failed, app: record.app || {},
    verdict: (() => { const v = verdictFor(record); return { ...v, sourceLabel: SOURCES[v.source].label }; })(),
    flags: flagsFor(record), steps,
  };
}

/**
 * A scope's stored records (`[{ dataKey, data }]` from storage.listTraceRecords)
 * as the timeline: turns oldest first, each follow-up agent placed after the
 * turn it came from, and every flag gathered at the top.
 */
export function describeTrace(items) {
  const parts = {};
  const records = [];
  for (const { dataKey, data } of items || []) {
    const kind = String(dataKey).split(':')[2];
    if (kind === 'p' && data?.hash) parts[data.hash] = data.text;
    else if ((kind === 't' || kind === 'b') && Array.isArray(data?.steps)) records.push(data);
  }
  records.sort((a, b) => a.at - b.at);
  const turns = records.map((r) => describeRecord(r, { parts }));
  return {
    turns,
    flags: turns.flatMap((t) => t.flags.map((f) => ({ ...f, turn: t.id, turnTitle: t.title }))),
    partial: turns.some((t) => t.partial),
  };
}
