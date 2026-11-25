/**
 * plato's one plain-language description of itself (#595): every AI agent,
 * every step a Trace records, every rule plato's code applies to a result,
 * and every outside service the app uses.
 *
 * The Trace view, the Privacy page, and the
 * generated docs/HOW_IT_WORKS.md all read from here, so there is one place to change the wording. Tests
 * (client/tests/transparency.test.js) fail when the code gains an agent, a
 * recorded step, a rule, an event or a service that isn't described here.
 *
 * Every entry says who decided: SOURCES below. That is what lets a person
 * tell the model's own output from what plato's instructions or code did to it.
 *
 * Pure data. Written for a reader who doesn't code.
 */

/** Who decided a step. */
export const SOURCES = Object.freeze({
  model: { label: 'The AI model', means: 'The model wrote or decided this.' },
  instructions: { label: 'plato’s instructions', means: 'A written prompt told the model to do this.' },
  code: { label: 'plato’s code', means: 'plato’s program did this itself, whatever the model said.' },
  person: { label: 'A person', means: 'The learner, the lesson’s author, or the classroom team wrote this.' },
});

/**
 * Every AI agent, one per prompt file in client/prompts: its name, purpose,
 * when it runs, what it reads and returns, taken from the header of its own
 * prompt file (scripts/generate-how-it-works.js). A Trace reads the same
 * header from the instructions a call actually sent (js/agentHeader.js).
 */
import { AGENTS } from './agents.generated.js';
import { HELD_PROGRESS, DRAFT_WORDS, VOICE_WORDS, COPY_WORDS, COPIED_SHARE, OWN_SHARE, MAX_TRANSCRIPT } from './assessment.js';
import { MAX_EXCHANGES, MIN_OBJECTIVES, MAX_OBJECTIVES, MINS_PER_EXCHANGE, MAX_PROGRESS, MAX_INSIGHTS } from './constants.js';

export { AGENTS };

// Agents' names, as their prompt files give them, for the wording below.
const N = {
  owner: AGENTS['lesson-owner'].label, assessor: AGENTS.assessor.label, claim: AGENTS['claim-check'].label,
  profile: AGENTS['learner-profile-update'].label, course: AGENTS['course-progress-update'].label,
};

/**
 * Every field plato's code puts in the coach's context (lessonEngine
 * buildContext), with where it comes from. `source` is who wrote the value.
 * `steers: true`: plato's code writes it to change what the coach does, so
 * the Trace lists it where plato stepped in.
 */
export const CONTEXT_FIELDS = Object.freeze({
  learnerName: { label: 'Your first name', source: 'person', from: 'Your account.' },
  lessonName: { label: 'Lesson name', source: 'person', from: 'The lesson, as its author wrote it.' },
  lessonDescription: { label: 'Lesson description', source: 'person', from: 'The lesson, as its author wrote it.' },
  exemplar: { label: 'What finished work looks like', source: 'model', from: `The ${N.owner}’s copy of the author’s exemplar, made when the lesson started.` },
  lessonStatus: { label: 'Lesson status', source: 'code', from: 'Active, or completed.' },
  objectives: { label: 'Objectives and what counts as evidence', source: 'model', from: `The ${N.owner}’s version of the author’s objectives, made when the lesson started.` },
  objectivesMet: { label: 'Objectives checked off so far', source: 'code', from: 'Kept by plato’s code; an objective stays checked off once it is.' },
  insights: { label: 'The coach’s notes on your work', source: 'model', from: 'Written by the coach on earlier messages in this lesson.' },
  learnerProfile: { label: 'Your profile summary', source: 'model', from: `Written by the ${N.profile} from earlier lessons and your own notes.` },
  learnerPosition: { label: 'Where you are', source: 'model', from: 'The coach’s latest one-line note on where you stand in this lesson.' },
  progress: { label: 'Progress so far', source: 'code', from: 'The score on record, 0 to 10.' },
  activitiesCompleted: { label: 'Exchanges so far', source: 'code', from: 'Counted by plato’s code, one per message until the lesson is complete.' },
  coachDirective: { label: 'The author’s instructions to the coach', source: 'person', from: 'The lesson’s optional Coach Directive section.' },
  unit: { label: 'Unit, and what you’ve shown in its other lessons', source: 'model', from: `The unit’s name, with the note the ${N.course} keeps.` },
  course: { label: 'Course', source: 'person', from: 'The course this lesson’s unit belongs to.' },
  enrichmentContext: { label: 'Background from plugins', source: 'code', from: 'Gathered once when the lesson started, by plugins the classroom turned on.' },
  pacingDirective: { label: 'A pacing instruction', source: 'code', steers: true, from: 'Added by plato’s code once the lesson runs past its usual length, telling the coach to move toward wrapping up. The lesson is never cut off.' },
  postCompletionDirective: { label: 'An instruction for after completion', source: 'code', steers: true, from: 'Added by plato’s code once the lesson is complete: the conversation is for feedback, and the score no longer changes.' },
});

/** The parts of an agent's instructions (promptAssembly.systemPromptParts), and who wrote each. */
export const PROMPT_PARTS = Object.freeze({
  prompt: { label: 'The agent’s instructions', source: 'instructions', means: 'Written by plato’s developers; the same for everyone. Public in plato’s source code.' },
  knowledgeBase: { label: 'Program knowledge base', source: 'person', means: 'Written by your classroom team to describe the program.' },
  catalog: { label: 'Lessons in this classroom', source: 'code', means: 'The names of the lessons you can see, listed by plato’s code.' },
  promptAfter: { label: 'The agent’s instructions (final part)', source: 'instructions', means: 'The last rules the model reads, placed after the classroom’s material so they aren’t lost.' },
  addendum: { label: 'A one-time addition from plato', source: 'code', means: 'plato’s code added this instruction for this one call (for example, when asking the coach to write a reply again).' },
  language: { label: 'Language', source: 'code', means: 'Added because your browser’s language isn’t English: write in that language, keep plato’s tags in English.' },
});

/**
 * The stages of one exchange, in order: how the Trace view groups the steps
 * so a person can follow what happened ("You sent" → "plato prepared" → "The
 * coach answered" → "plato checked" → "plato recorded" → "In the
 * background"). Each step type below names its stage.
 */
export const STAGES = Object.freeze({
  setup: { title: 'plato set up the lesson', means: `Once, when a lesson starts: the lesson as written, the ${N.owner}’s version of it, and anything plugins added.` },
  sent: { title: 'You sent', means: 'What you wrote or did, exactly as plato received it.' },
  prepared: { title: 'plato prepared and sent the request', means: 'plato’s code gathers the conversation so far and what it knows about you and the lesson, then sends it to the AI model.' },
  answered: { title: 'The AI model answered', means: 'The request to the model, its raw reply, and what plato read from it.' },
  checked: { title: 'plato checked the answer', means: 'Checks plato runs on the model’s answer, and what they changed.' },
  recorded: { title: 'plato recorded the result', means: 'What was saved, the rules plato’s code applied, and what was reported to the logs.' },
  background: { title: 'In the background', means: 'Other agents that ran after the reply, and what they changed.' },
});

/**
 * The checks plato's code runs on every coach reply, in order. The Trace
 * shows "plato checked the answer" as these questions, each with its answer
 * and the steps behind it.
 */
export const CHECKS = Object.freeze({
  tags: { title: 'Did the reply include its tags?', means: 'The coach ends each reply with tags only plato reads: a progress score, notes, and sometimes an observation for your profile.' },
  draft: { title: 'Did the reply write your answer for you?', means: `A coach that writes the learner’s answer teaches nothing, and the ${N.assessor} wouldn’t count it.` },
  language: { title: 'Was the reply in one language?', means: 'The AI model sometimes slips characters from another language into a reply. plato’s code looks for them.' },
  grading: { title: 'Is every objective the coach checked off shown in your own words?', means: `When the coach checks off an objective or scores 10, a second AI helper, the ${N.assessor}, must find each one in what you wrote.` },
});

/**
 * Every step type a Trace records (lib/lessonTrace.js, lessonEngine.js).
 * `stage` places it in an exchange (STAGES); `check` places a checked step
 * in its check (CHECKS); `title` names it; `source` says who decided;
 * `means` explains it (shown behind "ⓘ"). Numbers and tag names aren't
 * written here: the view reads them from what was recorded.
 */
export const STEPS = Object.freeze({
  lesson: { stage: 'setup', title: 'The lesson', source: 'person', means: 'The lesson as its author wrote it, and when it was last edited.' },
  planned: { stage: 'setup', title: `The ${N.owner}’s setup`, source: 'model', means: `The ${N.owner}, an AI helper, restated the author’s objectives with what would count as evidence. The coach and the ${N.assessor} use this version, not the author’s wording.` },
  validation: { stage: 'setup', title: `plato checked the ${N.owner}’s setup`, source: 'code', means: `plato’s code checked the setup had everything the coach and the ${N.assessor} need (the exact list is shown). If not, it asked once more and used the second answer.` },
  plugins: { stage: 'setup', title: 'Extra context from plugins', source: 'code', means: 'Plugins the classroom has turned on can add background for the coach when a lesson starts. Each plugin’s own work is listed with it: the AI calls it made, the outside requests it sent, and its notes.' },
  input: { stage: 'sent', title: 'What you sent', source: 'person', means: 'Your message, with any images and attached web pages.' },
  state: { stage: 'prepared', title: 'Where the lesson stood', source: 'code', means: 'The progress and objectives on record before this message.' },
  tail: { stage: 'prepared', title: 'The conversation so far', source: 'code', means: 'plato sends the latest messages, up to a limit. Images and attached pages from earlier messages are not sent again.' },
  context: { stage: 'prepared', title: 'What plato told the coach', source: 'code', means: 'Before every reply plato’s code gathers what the coach should know about you and the lesson, and sends it as the first message.' },
  history: { stage: 'prepared', title: 'The messages sent to the model', source: 'code', means: 'The exact list of messages every coach call on this turn starts from.' },
  call: {
    stage: 'answered', title: 'A call to the AI model', source: 'model', means: 'One request to the model and its raw reply.',
    // The Trace shows a call as two steps, the request and the reply.
    request: { title: 'Sent to the AI model', source: 'code', means: 'plato’s code sends the agent’s instructions and the messages. Size is counted in tokens, the pieces of text a model reads (a token is about three quarters of a word).' },
    reply: { title: 'The AI model replied', source: 'model', means: 'What came back, word for word, how long it took, and why it stopped.' },
  },
  parsed: { stage: 'answered', title: 'What plato read from the reply', source: 'code', means: 'The coach ends each reply with tags that only plato’s code reads. You see the text before them.' },
  tagCheck: { stage: 'checked', check: 'tags', title: 'Were the reply’s tags there?', source: 'code', means: 'plato’s code looks for the tags it needs. Without them, nothing from the reply can be recorded.' },
  draftCheck: { stage: 'checked', check: 'draft', title: 'Did the reply write the answer for you?', source: 'code', means: 'plato’s code looks for a long quoted passage, or wording like “here’s a draft”, which would mean the coach wrote what you should write yourself.' },
  tagRepair: { stage: 'checked', check: 'tags', title: 'What the second request got back', source: 'instructions', means: 'The coach left off its tags, so plato asked it for just the tags of the reply it gave.' },
  draftGuard: { stage: 'checked', check: 'draft', title: 'The coach wrote your answer for you', source: 'instructions', means: 'The first reply drafted the learner’s answer. plato asked the coach to give feedback and a question instead, and showed that reply.' },
  claimsRemoved: { stage: 'checked', check: 'grading', title: 'The reply said an objective was met that wasn’t', source: 'code', means: 'The check didn’t find that objective in your own words, so plato’s code took out the sentence saying it was met.' },
  literals: { stage: 'checked', check: 'language', title: 'The author’s link or code, exactly', source: 'code', means: 'The reply changed a link or code from the lesson author’s instructions slightly, so plato’s code put back the author’s exact text.' },
  scriptCheck: { stage: 'checked', check: 'language', title: 'Was the reply in one language?', source: 'code', means: 'plato’s code looks for characters from a script your language doesn’t use, such as Chinese characters in an English reply, or for a reply that isn’t in your language’s own script (Bengali, Hindi, Arabic and others).' },
  scriptGuard: { stage: 'checked', check: 'language', title: 'The reply mixed in another language', source: 'instructions', means: 'plato asked the coach to write the same reply again in your language, and showed the rewrite if it came back clean.' },
  gradingPlan: { stage: 'checked', check: 'grading', title: 'Whether to check the grading', source: 'code', means: `The ${N.assessor} runs only when the coach checks off an objective or scores 10.` },
  gradingRetry: { stage: 'checked', check: 'grading', title: `The ${N.assessor}’s answer couldn’t be read`, source: 'code', means: 'Its reply wasn’t in the expected format, so plato asked once more.' },
  verdict: { stage: 'checked', check: 'grading', title: `The ${N.assessor}’s verdict`, source: 'model', means: 'For each objective, the quote it relied on. plato’s code then looked for each quote in your own messages: a quote counts only if you wrote it, and didn’t copy it from the coach.' },
  recheck: { stage: 'checked', check: 'grading', title: `Asked the ${N.assessor} again`, source: 'code', means: 'A quote wasn’t the learner’s own words, so plato asked once more about just that objective.' },
  gradingFailed: { stage: 'checked', check: 'grading', title: `The ${N.assessor} couldn’t run`, source: 'code', means: 'The check failed this turn, so nothing new was checked off.' },
  gradingStood: { stage: 'checked', check: 'grading', title: 'The coach’s grading stood', source: 'code', means: 'The check failed on two completing turns in a row, so plato accepted the coach’s grading rather than leave the learner stuck.' },
  verdictApplied: { stage: 'checked', check: 'grading', title: 'What the check changed', source: 'code', means: 'Objectives the coach claimed without backing were taken off; a completion that wasn’t backed up was held.' },
  heldRewrite: { stage: 'checked', check: 'grading', title: 'The coach was asked to reply again', source: 'instructions', means: 'Completion was held, so plato told the coach what was missing and asked for a new reply.' },
  claimCheck: { stage: 'checked', check: 'grading', title: 'Does the reply say the lesson is done?', source: 'code', means: 'With completion held, the reply mustn’t say the lesson is finished. plato checks the wording against known phrases, then asks the model.' },
  replyReplaced: { stage: 'checked', check: 'grading', title: 'plato replaced the coach’s reply', source: 'code', means: 'The reply still said the lesson was done, so plato’s code showed a standard message instead.' },
  positionReplaced: { stage: 'checked', check: 'grading', title: 'plato replaced the “Where you are” note', source: 'code', means: 'The coach’s note said the lesson was done while completion was held.' },
  applied: { stage: 'recorded', title: 'What was recorded, and the rules plato applied', source: 'code', means: 'plato’s code, not the model, decides what is saved: see RULES.' },
  save: { stage: 'recorded', title: 'Saved', source: 'code', means: 'What was written to plato’s database, and whether it worked.' },
  event: { stage: 'recorded', title: 'Reported to the logs', source: 'code', means: 'A short code and the lesson’s id, so the team can count how often this happens. No conversation text.' },
  followUp: { stage: 'background', title: 'A follow-up was queued', source: 'code', means: 'Another agent runs in the background after the reply.' },
  followUpStart: { stage: 'background', title: 'A follow-up agent ran', source: 'code', means: 'This ran in the background, after the reply it came from.' },
  noteScreened: { stage: 'checked', title: 'A note was held back', source: 'code', means: 'The note read like an instruction rather than information about the learner, so it wasn’t given to the agent.' },
  profileSaved: { stage: 'recorded', title: 'The learner profile was updated', source: 'code', means: 'plato’s code merged the agent’s result into the profile. Your own notes and your lesson lists are kept as they are.' },
  profileUnchanged: { stage: 'recorded', title: 'The learner profile was not changed', source: 'code', means: 'Nothing usable came back, so the profile stayed as it was.' },
  unitNoteSaved: { stage: 'background', title: 'The unit note was updated', source: 'code', means: 'The short note the coach in this unit’s other lessons will see.' },
  unitNoteUnchanged: { stage: 'background', title: 'The unit note was not changed', source: 'code', means: 'Nothing usable came back, so the note stayed as it was.' },
  noteChange: { stage: 'sent', title: 'What you did', source: 'person', means: 'A note you added to or removed from your profile in Settings. Notes you add are kept word for word.' },
  shown: { stage: 'recorded', title: 'What you were shown', source: 'code', means: 'The reply that was kept. If a later reply replaced the first, you watched the first one arrive before it changed.' },
  error: { stage: 'recorded', title: 'This attempt failed', source: 'code', means: 'Nothing from this attempt was saved to the conversation.' },
});

/**
 * The rules plato's code applies to a result (ids from
 * lessonTrace.rulesApplied, plus the opener's). All `source: 'code'`.
 */
export const RULES = Object.freeze({
  noProgressTag: 'The reply had no progress score, so the score stayed where it was.',
  clamped: `The score is kept between 0 and ${MAX_PROGRESS}, as a whole number.`,
  openerCap: `The opening message can’t finish a lesson: its score is capped at ${MAX_PROGRESS - 1}.`,
  cappedAt9: `A score of ${MAX_PROGRESS} completes the lesson only when every objective is checked off. Until then it is recorded as ${MAX_PROGRESS - 1}.`,
  heldAt8: `The coach scored ${MAX_PROGRESS}, but the ${N.assessor} couldn’t find every objective in the learner’s own words. Completion was held and the score recorded as at most ${HELD_PROGRESS}.`,
  objectivesNotBackedUp: `The coach checked off an objective the ${N.assessor} couldn’t back up with the learner’s own words, so it wasn’t checked off.`,
  checkFailedNothingCounted: `The ${N.assessor} couldn’t run this turn, so nothing new was checked off and a completion waits for the next turn.`,
  checkFailedTwiceGradingStood: `The ${N.assessor} couldn’t run on two completing turns in a row, so the coach’s grading was accepted.`,
  replyReplaced: 'The coach’s reply said the lesson was done while completion was held, so a standard message was shown instead.',
  frozenAfterCompletion: 'The lesson is complete: the score and the count of exchanges no longer change. Notes still do.',
  notesFolded: `Only the ${MAX_INSIGHTS} newest notes are kept in full; older ones are folded into one line.`,
  completed: `Score ${MAX_PROGRESS} with every objective checked off: the lesson was marked complete.`,
});

/**
 * The numbers behind the rules, by the name the code uses. `where` is the
 * file that owns the value; the test checks every exported scoring or pacing
 * constant appears here.
 */
export const THRESHOLDS = Object.freeze({
  MAX_PROGRESS: { where: 'client/src/lib/constants.js', means: `Progress runs from 0 to ${MAX_PROGRESS}; ${MAX_PROGRESS} with every objective checked off completes a lesson.` },
  MAX_INSIGHTS: { where: 'client/src/lib/constants.js', means: `The coach’s ${MAX_INSIGHTS} newest notes are kept in full.` },
  MAX_EXCHANGES: { where: 'client/src/lib/constants.js', means: `A lesson is designed for about ${MAX_EXCHANGES} exchanges. Past that the coach is told to wrap up; the lesson is never cut off.` },
  MIN_OBJECTIVES: { where: 'client/src/lib/constants.js', means: `A lesson has at least ${MIN_OBJECTIVES} objectives.` },
  MAX_OBJECTIVES: { where: 'client/src/lib/constants.js', means: `A lesson has at most ${MAX_OBJECTIVES} objectives.` },
  MINS_PER_EXCHANGE: { where: 'client/src/lib/constants.js', means: `Time estimates assume ${MINS_PER_EXCHANGE} minutes per exchange.` },
  HELD_PROGRESS: { where: 'client/src/lib/assessment.js', means: `A held completion is recorded as at most ${HELD_PROGRESS}.` },
  DRAFT_WORDS: { where: 'client/src/lib/assessment.js', means: `A quoted passage of ${DRAFT_WORDS} or more words in a reply counts as the coach drafting the learner’s answer.` },
  VOICE_WORDS: { where: 'client/src/lib/assessment.js', means: `A quoted sample of ${VOICE_WORDS} or more words written as the learner (“I…”, “my…”) that the learner didn’t write counts as writing their answer for them too.` },
  COPY_WORDS: { where: 'client/src/lib/assessment.js', means: `A quote of ${COPY_WORDS} or more words that the coach wrote first doesn’t count as the learner’s.` },
  COPIED_SHARE: { where: 'client/src/lib/assessment.js', means: `Nor does a quote mostly in the coach’s wording: when more than ${Math.round(COPIED_SHARE * 100)}% of its three-word phrases appeared first in the coach’s messages (its sentences joined up, or sent back with a word swapped). The coach polishing the learner’s own words still counts as theirs.` },
  OWN_SHARE: { where: 'client/src/lib/assessment.js', means: `A passage the coach wrote first still counts as the learner’s when ${Math.round(OWN_SHARE * 100)}% or more of its words (allowing for spelling slips) were in the learner’s earlier messages: the coach only polished their text.` },
  MAX_TRANSCRIPT: { where: 'client/src/lib/assessment.js', means: `The ${N.assessor} reads the last ${MAX_TRANSCRIPT} messages.` },
});

/**
 * The words a Trace uses, for a first-time reader (one "How to read a trace"
 * note at the top of the Trace, and "ⓘ" beside the terms).
 */
export const GLOSSARY = Object.freeze([
  { term: 'AI model', means: 'The one program that writes every reply. plato sends it requests and reads what comes back.' },
  { term: 'Agent', means: 'The AI model given a particular set of instructions, for one job: the Coach, the Assessor, and so on. Each agent’s instructions are a file in plato’s source code.' },
  { term: 'Request', means: 'One message from plato’s code to the AI model, with three parts: the instructions (read first), the messages (the conversation it replies to, some written by plato), and the settings (limits such as the longest reply).' },
  { term: 'Token', means: 'The pieces of text a model reads and writes; a token is about three quarters of a word.' },
  { term: 'Who decided', means: Object.values(SOURCES).map((x) => `${x.label}: ${x.means}`).join(' ') },
  { term: 'Stepped in', means: 'plato’s code or instructions changed what the model produced: asked again, held a completion, replaced a reply, or added an instruction.' },
]);

/** The codes the app reports to the server's logs (orchestrator.reportEvent), in plain words. */
export const EVENTS = Object.freeze({
  coach_tags_recovered: 'The coach’s reply was missing its tags and plato got them on a second ask.',
  coach_tags_unrecovered: 'The coach’s reply was missing its tags and the second ask didn’t supply them.',
  conversation_too_long: 'The conversation passed the size limit and can no longer be saved.',
  coach_completion_held: `A completion was held by the ${N.assessor}.`,
  coach_objectives_unverified: 'An objective the coach checked off wasn’t backed up.',
  coach_assessment_failed: `The ${N.assessor} couldn’t run.`,
  coach_assessment_failed_open: `The ${N.assessor} couldn’t run twice in a row and the coach’s grading stood.`,
  coach_draft_rewritten: 'A reply that drafted the learner’s answer was rewritten.',
  coach_draft_kept: 'A reply that drafted the learner’s answer was rewritten, and the rewrite still drafted.',
  coach_script_rewritten: 'A reply that mixed in characters from another language (such as Chinese in an English reply) was rewritten.',
  coach_script_kept: 'A reply that mixed in another language was rewritten, and the rewrite still did, so the reply was kept.',
  coach_literal_restored: 'A reply changed a link or code from the lesson author’s instructions slightly; plato put back the author’s exact text.',
});

/**
 * Every outside service the app uses. `sent` is what plato gives it; `when`
 * says whether every install uses it (`always`) or only when the classroom
 * turns something on (`plugin` names the plugin that brings it in). The
 * Technology view adds this install's facts (region, which plugins are on).
 */
export const SERVICES = Object.freeze({
  bedrock: { name: 'Amazon Bedrock', role: 'Runs the AI model.', when: 'always', sent: 'Each AI call: the agent’s instructions, the context plato assembled, the recent conversation, and this message’s images and attached page text.', note: 'Amazon does not use prompts or replies to train models.' },
  model: { name: 'Qwen3-VL 235B', role: 'The AI model behind every agent.', when: 'always', sent: 'Reached through Amazon Bedrock.', note: 'Open source (Apache-2.0 licence), made by Alibaba Cloud’s Qwen team, run by Amazon.' },
  dynamodb: { name: 'Amazon DynamoDB', role: 'plato’s database.', when: 'always', sent: 'Accounts, lessons, conversations, images, profiles, and traces.' },
  lambda: { name: 'AWS Lambda and API Gateway', role: 'Run plato’s server code.', when: 'always', sent: 'Every request to plato passes through them.' },
  cloudfront: { name: 'Amazon CloudFront and AWS WAF', role: 'Deliver the app and screen incoming traffic.', when: 'always', sent: 'Every request to plato passes through them.' },
  logs: { name: 'Amazon CloudWatch Logs', role: 'plato’s error log.', when: 'always', sent: 'Error codes with a user id and lesson id. Never conversation text.' },
  ses: { name: 'Amazon SES', role: 'Sends plato’s email.', when: 'always', sent: 'Invites, password resets, reminders and digests: your email address, name, and lesson names. Never conversation text.' },
  ssm: { name: 'AWS Systems Manager', role: 'Holds the server’s settings.', when: 'always', sent: 'Nothing about learners.' },
  linkFetch: { name: 'Web pages you attach', role: 'plato’s server reads a page you attach to a message.', when: 'when a learner attaches a link', sent: 'A request for that page from plato’s server. The site doesn’t learn who you are.' },
  sso: { name: 'Your institution’s sign-in (Microsoft Entra)', role: 'Signs you in with your institution account.', plugin: 'entra-sso', when: 'when the classroom turns on single sign-on', sent: 'A sign-in request. plato receives your name, email and an id; nothing about your lessons is sent.' },
  slack: { name: 'Slack', role: 'Invites and links classroom members.', plugin: 'slack', when: 'when the classroom connects Slack', sent: 'Email addresses, to find or invite members. Never lesson content.' },
  wordpress: { name: 'WordPress.org and GitHub', role: 'Background for lessons about WordPress.', plugin: 'wordpress-info', when: 'when the classroom turns on the WordPress Info plugin', sent: 'Search terms written from the lesson (not from your messages) to developer.wordpress.org, make.wordpress.org and api.github.com.' },
});
