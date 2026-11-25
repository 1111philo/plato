/**
 * One Coach turn, as lessonEngine.sendMessage runs it, with the version's own
 * code: the context from `buildContext` (rebuilt every turn from the lesson
 * record), the last COACH_TAIL messages, one tag repair when tags are missing,
 * the draft guard, the script guard and the grading check where the version
 * has them, and
 * completion decided by `applyCoachResponseToKB`, the single owner. Shared by
 * the Coach's single moments, the whole lessons and the chains, so all three
 * measure the same pipeline.
 */
import { CATALOG } from '../fixtures/lessons.js';

/**
 * `history` is the stored conversation so far ([{ role, content }], the
 * learner as 'user'); `message` the learner's new message, with `images`
 * (data URLs) when they sent a screenshot. Returns the parsed reply, the
 * lesson record before and after, and what changed.
 */
export async function coachTurn({ app, model, lesson, kb, profile = 'No profile yet', name = 'Sam', courseProgress = null, programKb = '', language = '', history = [], message, images = [], links = [] }) {
  const { engine, assessment, orchestrator, work } = app;
  const tail = history.slice(-(engine.COACH_TAIL || 40)).filter((m) => m.content && String(m.content).trim());
  // A screenshot or an attached page, as sendMessage sends them (buildUserParts).
  const parts = (images.length || links.length) && engine.buildUserParts ? engine.buildUserParts(message || '', images, links) : null;
  const messages = [
    { role: 'user', content: engine.buildContext(lesson, kb, profile, name, courseProgress, app.languageFor(language) || null) },
    { role: 'assistant', content: 'Ready.' },
    ...tail,
    ...(message != null || parts ? [{ role: 'user', content: parts && !(parts.length === 1 && parts[0].type === 'text') ? parts : message }] : []),
  ];
  // A message that repeats the coach's own wording, or only agrees to its
  // draft: this version answers it in code (copyReply), an older one with a
  // note to the coach, an older one still not at all.
  const coachSaid = assessment?.assessmentTranscript ? assessment.assessmentTranscript(messages).filter((m) => m.by === 'coach').map((m) => m.text) : [];
  const said = typeof message === 'string' ? message : '';
  const priorLearner = assessment?.assessmentTranscript ? assessment.assessmentTranscript(messages).filter((m) => m.by === 'learner').map((m) => m.text) : [];
  const repeated = !!(assessment?.repeatsCoach && assessment.repeatsCoach(said, coachSaid));
  const agreed = !repeated && !!(assessment?.copyReply || assessment?.AGREED_ADDENDUM) && assessment.onlyAgrees(said) && assessment.draftsForLearner(coachSaid[coachSaid.length - 1] || '', priorLearner);
  const turnNote = assessment?.copyReply ? '' : repeated ? assessment.REPEATED_ADDENDUM || '' : agreed ? assessment.AGREED_ADDENDUM || '' : '';
  const system = (addendum = '') => app.system('coach', { kb: programKb, catalog: CATALOG, addendum: [turnNote, addendum].filter(Boolean).join('\n\n---\n\n'), language });
  const coach = (addendum, msgs = messages, maxTokens = 2048) => model.call({ system: system(addendum), messages: msgs, maxTokens });
  // The tag repair has its own instructions only, as orchestrator.repairCoachTags sends it.
  const repair = (reply) => model.call({ system: app.system('coach', { kb: programKb, catalog: CATALOG, addendum: orchestrator.TAG_REPAIR_ADDENDUM, language }), messages: [...messages, { role: 'assistant', content: reply || '…' }, { role: 'user', content: orchestrator.TAG_REPAIR_CUE }], maxTokens: 600 });
  const parseAndRepair = async (raw) => {
    const first = engine.parseCoachResponse(raw);
    return engine.recoverMissingTags ? engine.recoverMissingTags(first, () => repair(first.text)) : first;
  };

  const learnerSaidEarly = assessment?.assessmentTranscript ? assessment.assessmentTranscript(messages).filter((m) => m.by === 'learner').map((m) => m.text) : [];
  let parsed;
  if (assessment?.copyReply && (repeated || agreed)) {
    const lang = app.languageFor(language) || null;
    let fixed = assessment.copyReply(agreed ? 'agreed' : 'repeated', lang);
    if (lang && !(assessment.hasFixedReplies ? assessment.hasFixedReplies(lang) : false)) {
      try { fixed = engine.parseCoachResponse(await coach(assessment.localizeAddendum(fixed), messages, 600)).text || fixed; } catch { /* keep the English */ }
    }
    parsed = engine.parseCoachResponse(`${fixed}\n[PROGRESS: ${kb.progress ?? 0}]\n[KB_UPDATE: {}]`);
  } else parsed = await parseAndRepair(await coach());
  const platoReply = !!assessment?.copyReply && (repeated || agreed) && !!assessment.hasFixedReplies;
  // Example answers in the learner's voice are cut first, where this version does.
  const cut = (p) => (assessment?.withoutVoiceSamples && kb.status !== 'completed' && !platoReply && p.text ? { ...p, text: assessment.withoutVoiceSamples(p.text, learnerSaidEarly) || p.text } : p);
  const uncut = parsed.text;
  parsed = cut(parsed);
  // The draft guard (#584), where this version has it.
  const learnerSaid = learnerSaidEarly;
  const several = (t) => !!assessment?.copyReply && (String(t).match(/\?/g) || []).length > 1;
  if (assessment?.draftsForLearner && assessment.DRAFT_ADDENDUM && kb.status !== 'completed' && !platoReply && (assessment.draftsForLearner(parsed.text || '', learnerSaid) || (parsed.text !== uncut && several(parsed.text)))) {
    const again = await parseAndRepair(await coach(assessment.DRAFT_ADDENDUM));
    if (again.text) parsed = again;
    // A sample in the learner's voice that survived the rewrite comes out, where this version does.
    if (assessment.withoutVoiceSamples && assessment.draftsForLearner(parsed.text || '', learnerSaid)) parsed = { ...parsed, text: assessment.withoutVoiceSamples(parsed.text, learnerSaid) };
    // Still drafting: the drafted passages come out in code, where this version does.
    if (assessment.withoutDrafts && assessment.draftsForLearner(parsed.text || '', learnerSaid)) parsed = { ...parsed, text: assessment.withoutDrafts(parsed.text, learnerSaid, assessment.hasFixedReplies?.(app.languageFor(language) || null) ? app.languageFor(language) || null : null) };
  }
  // The script guard, where this version has it: a reply that mixes in another
  // script is rewritten once, and the rewrite used only when it's clean.
  const lang = app.languageFor(language) || null;
  if (assessment?.mixesScripts && assessment.SCRIPT_ADDENDUM && assessment.mixesScripts(parsed.text, lang)) {
    const again = await parseAndRepair(await coach(assessment.SCRIPT_ADDENDUM));
    if (again.text && !assessment.mixesScripts(again.text, lang)) parsed = again;
  }
  // The directive's exact links and codes, where this version restores them.
  if (assessment?.withDirectiveLiterals && parsed.text) parsed = { ...parsed, text: assessment.withDirectiveLiterals(parsed.text, lesson.coachDirective) };
  // The grading check, where this version has it.
  let graded = null;
  if (engine.checkGrading) {
    graded = await engine.checkGrading({
      lesson, kb, parsed, messages,
      imageParts: (parts || []).filter((p) => p.type === 'image'),
      assess: (input, imgs, o) => model.call({ system: app.system('assessor'), messages: [{ role: 'user', content: imgs?.length ? [{ type: 'text', text: input }, ...imgs] : input }], maxTokens: 2048, temperature: o?.temperature ?? 0 }),
      regenerate: (addendum) => coach(addendum),
      ...(app.languageFor(language) ? { localize: (addendum) => coach(addendum, messages, 600) } : {}),
      judgeClaim: async (t) => /^\s*yes/i.test(await model.call({ system: app.system('claim-check'), messages: [{ role: 'user', content: String(t).slice(0, 8000) }], maxTokens: 5, temperature: 0 })),
    });
    parsed = graded.parsed;
  }
  const merged = work?.mergeObjectivesMet ? work.mergeObjectivesMet(kb, parsed.kbUpdate) : kb;
  let { lessonKB: after, achieved } = engine.applyCoachResponseToKB(merged, parsed);
  if (graded?.assessment && engine.nextGradingFailures) {
    const failures = engine.nextGradingFailures(after.gradingCheckFailures, graded.assessment);
    if (failures || after.gradingCheckFailures) after = { ...after, gradingCheckFailures: failures };
  }
  const before = new Set(kb.objectivesMet || []);
  return {
    parsed,
    text: parsed.text || '',
    before: kb,
    after,
    achieved: !!achieved,
    completed: kb.status !== 'completed' && !!achieved,
    newlyMet: (after.objectivesMet || []).filter((i) => !before.has(i)).map((i) => i + 1),
    assessment: graded?.assessment || null,
  };
}

/**
 * The lesson's first message, as lessonEngine.startLesson sends it: "Start
 * the lesson." (not stored), 1024 tokens, no grading check, the score capped
 * by `openingProgress` (an opener can't finish a lesson). Returns the reply
 * and the lesson record after it.
 */
export async function coachOpening({ app, model, lesson, kb, profile = 'No profile yet', name = 'Sam', courseProgress = null, programKb = '', language = '' }) {
  const { engine } = app;
  const raw = await model.call({
    system: app.system('coach', { kb: programKb, catalog: CATALOG, language }),
    messages: [
      { role: 'user', content: engine.buildContext(lesson, kb, profile, name, courseProgress, app.languageFor(language) || null) },
      { role: 'assistant', content: 'Ready.' },
      { role: 'user', content: 'Start the lesson.' },
    ],
    maxTokens: 1024,
  });
  const parsed = engine.parseCoachResponse(raw);
  const { progress } = parsed;
  const exact = app.assessment?.withDirectiveLiterals ? app.assessment.withDirectiveLiterals(parsed.text, lesson.coachDirective) : parsed.text;
  // Example answers in the learner's voice are cut from the opener, where this version does.
  const text = app.assessment?.copyReply && app.assessment.withoutVoiceSamples ? app.assessment.withoutVoiceSamples(exact, []) || exact : exact;
  const score = engine.openingProgress ? engine.openingProgress(progress) : null;
  return { text: text || '', progress, after: score != null ? { ...kb, progress: score } : kb };
}
