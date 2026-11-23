/**
 * plato's one plain-language description of itself (#595): every AI agent,
 * every step a Trace records, every rule plato's code applies to a result,
 * and every outside service the app uses.
 *
 * The Trace view, "Behind this response", the "How assessment works" and
 * Privacy pages, and the generated docs/HOW_IT_WORKS.md all read from here,
 * so there is one place to change the wording. Tests
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
 * Every AI agent: one per prompt file in client/prompts. `label` is the name
 * shown to people; `reads` and `writes` are what it is given and what its
 * output is used for.
 */
export const AGENTS = Object.freeze({
  coach: {
    label: 'Coach',
    purpose: 'Talks with the learner: teaches, asks questions, and reports how far along they are.',
    when: 'At the start of a lesson and on every message.',
    reads: ['its instructions', 'the classroom’s program knowledge base', 'the list of lessons', 'the lesson (exemplar, objectives, author’s coach directive)', 'the learner’s profile summary', 'this lesson’s notes and progress', 'the last 40 messages', 'this message’s images and attached pages'],
    writes: ['the reply the learner reads', 'a progress score from 0 to 10', 'notes about the learner’s work', 'which objectives it believes are met', 'sometimes an observation for the learner’s profile'],
  },
  assessor: {
    label: 'Assessment check',
    purpose: 'A second opinion on grading. For each objective the coach wants to check off, it must quote the learner’s own words.',
    when: 'Only on a message where the coach checks off an objective or scores 10.',
    reads: ['its instructions', 'the exemplar and the objectives’ wording', 'the conversation, labelled by who wrote each message', 'this message’s images'],
    writes: ['for each objective: shown or not, the quote it relied on, or what is missing'],
  },
  'claim-check': {
    label: 'Completion wording check',
    purpose: 'Answers one question, yes or no: does this reply tell the learner the lesson is done?',
    when: 'Only when plato has held a completion and the reply’s wording isn’t one it recognises.',
    reads: ['its instructions', 'the coach’s reply'],
    writes: ['yes or no'],
  },
  'lesson-owner': {
    label: 'Lesson planner',
    purpose: 'Sets up this learner’s copy of the lesson: restates each objective with what would count as evidence.',
    when: 'Once, when the lesson starts.',
    reads: ['its instructions', 'the lesson as the author wrote it', 'the learner’s profile summary'],
    writes: ['the objectives and evidence the coach and the assessment check use', 'a copy of the exemplar', 'a starting note on where the learner is'],
  },
  'learner-profile-update': {
    label: 'Learner profile',
    purpose: 'Keeps the learner’s profile up to date from one new piece of information.',
    when: 'When the coach notes something about the learner, or the learner adds or removes a note in Settings.',
    reads: ['its instructions', 'the current profile', 'the new observation or note'],
    writes: ['an updated profile and a short summary'],
  },
  'learner-profile-owner': {
    label: 'Learner profile (on completion)',
    purpose: 'Updates the learner’s profile from a whole finished lesson.',
    when: 'Once, when a lesson is completed.',
    reads: ['its instructions', 'the current profile', 'this lesson’s notes and progress'],
    writes: ['an updated profile and a short summary'],
  },
  'course-progress-update': {
    label: 'Unit progress',
    purpose: 'Keeps a short note of what the learner has shown across a unit’s lessons, so the coach in the next lesson knows.',
    when: 'Once, when a lesson that belongs to a unit is completed.',
    reads: ['its instructions', 'the unit’s earlier note', 'this lesson’s notes', 'the unit’s list of lessons'],
    writes: ['the unit note (about 600 characters)'],
  },
  'lesson-creator': {
    label: 'Lesson creator',
    purpose: 'Helps a member of the classroom team design a lesson by conversation.',
    when: 'In the lesson editor.',
    reads: ['its instructions', 'the program knowledge base', 'the list of lessons, including private ones', 'the editing conversation'],
    writes: ['its replies', 'a readiness score from 0 to 10'],
  },
  'lesson-extractor': {
    label: 'Lesson writer',
    purpose: 'Writes the lesson itself from the editing conversation.',
    when: 'When the team member refreshes the lesson preview or creates the lesson.',
    reads: ['its instructions', 'the editing conversation'],
    writes: ['the lesson: name, description, exemplar, objectives, optional coach directive'],
  },
  'knowledge-base-editor': {
    label: 'Knowledge base editor',
    purpose: 'Helps a member of the classroom team describe the program by conversation.',
    when: 'In the Customizer and first-time setup.',
    reads: ['its instructions', 'the program knowledge base', 'the list of lessons', 'the editing conversation'],
    writes: ['its replies', 'a readiness score from 0 to 10'],
  },
  'knowledge-base-extractor': {
    label: 'Knowledge base writer',
    purpose: 'Writes the program knowledge base from the editing conversation.',
    when: 'When the team member saves the knowledge base.',
    reads: ['its instructions', 'the existing knowledge base', 'the editing conversation'],
    writes: ['the program knowledge base'],
  },
});

/**
 * Every field plato's code puts in the coach's context (lessonEngine
 * buildContext), with where it comes from. `source` is who wrote the value.
 */
export const CONTEXT_FIELDS = Object.freeze({
  learnerName: { label: 'Your first name', source: 'person', from: 'Your account.' },
  lessonName: { label: 'Lesson name', source: 'person', from: 'The lesson, as its author wrote it.' },
  lessonDescription: { label: 'Lesson description', source: 'person', from: 'The lesson, as its author wrote it.' },
  exemplar: { label: 'What finished work looks like', source: 'model', from: 'The lesson planner’s copy of the author’s exemplar, made when the lesson started.' },
  lessonStatus: { label: 'Lesson status', source: 'code', from: 'Active, or completed.' },
  objectives: { label: 'Objectives and what counts as evidence', source: 'model', from: 'The lesson planner’s version of the author’s objectives, made when the lesson started.' },
  objectivesMet: { label: 'Objectives checked off so far', source: 'code', from: 'Kept by plato’s code; an objective stays checked off once it is.' },
  insights: { label: 'The coach’s notes on your work', source: 'model', from: 'Written by the coach on earlier messages in this lesson.' },
  learnerProfile: { label: 'Your profile summary', source: 'model', from: 'Written by the learner profile agent from earlier lessons and your own notes.' },
  learnerPosition: { label: 'Where you are', source: 'model', from: 'The coach’s latest one-line note on where you stand in this lesson.' },
  progress: { label: 'Progress so far', source: 'code', from: 'The score on record, 0 to 10.' },
  activitiesCompleted: { label: 'Exchanges so far', source: 'code', from: 'Counted by plato’s code, one per message until the lesson is complete.' },
  coachDirective: { label: 'The author’s instructions to the coach', source: 'person', from: 'The lesson’s optional Coach Directive section.' },
  unit: { label: 'Unit, and what you’ve shown in its other lessons', source: 'model', from: 'The unit’s name, with the note the unit progress agent keeps.' },
  course: { label: 'Course', source: 'person', from: 'The course this lesson’s unit belongs to.' },
  enrichmentContext: { label: 'Background from plugins', source: 'code', from: 'Gathered once when the lesson started, by plugins the classroom turned on.' },
  pacingDirective: { label: 'A pacing instruction', source: 'code', from: 'Added by plato’s code once the lesson runs past its usual length, telling the coach to move toward wrapping up. The lesson is never cut off.' },
  postCompletionDirective: { label: 'An instruction for after completion', source: 'code', from: 'Added by plato’s code once the lesson is complete: the conversation is for feedback, and the score no longer changes.' },
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
 * Every step type a Trace records (lib/lessonTrace.js, lessonEngine.js).
 * `title` names it; `source` says who decided; `means` explains it.
 */
export const STEPS = Object.freeze({
  lesson: { title: 'The lesson', source: 'person', means: 'The lesson as its author wrote it, and when it was last edited.' },
  planned: { title: 'The lesson planner’s setup', source: 'model', means: 'The planner restated the author’s objectives with what would count as evidence. The coach and the assessment check use this version, not the author’s wording.' },
  validation: { title: 'Checked the planner’s setup', source: 'code', means: 'plato’s code checked the setup had the right shape. If not, it asked once more and used the second answer.' },
  plugins: { title: 'Extra context from plugins', source: 'code', means: 'Plugins the classroom has turned on can add background for the coach when a lesson starts. Each plugin’s own work is listed with it: the AI calls it made, the outside requests it sent, and its notes.' },
  input: { title: 'What you sent', source: 'person', means: 'Your message, with any images and attached web pages.' },
  state: { title: 'Where the lesson stood', source: 'code', means: 'The progress and objectives on record before this message.' },
  tail: { title: 'The conversation so far', source: 'code', means: 'plato sends the last 40 messages. Images and attached pages from earlier messages are not sent again.' },
  context: { title: 'What plato told the coach about you and the lesson', source: 'code', means: 'plato’s code gathers this before every reply: the lesson, your progress, notes, and profile summary.' },
  history: { title: 'The messages sent to the model', source: 'code', means: 'The exact list of messages every coach call on this turn starts from.' },
  call: { title: 'A call to the AI model', source: 'model', means: 'One request to the model and its raw reply.' },
  parsed: { title: 'What plato read from the reply', source: 'code', means: 'The coach ends each reply with tags only plato’s code reads: a progress score and notes. The learner sees the text before them.' },
  tagRepair: { title: 'The reply’s tags were missing', source: 'instructions', means: 'The coach left off its tags, so plato asked it for just the tags of the reply it gave.' },
  draftGuard: { title: 'The coach wrote your answer for you', source: 'instructions', means: 'The first reply drafted the learner’s answer. plato asked the coach to give feedback and a question instead, and showed that reply.' },
  gradingPlan: { title: 'Whether to check the grading', source: 'code', means: 'The assessment check runs only when the coach checks off an objective or scores 10.' },
  gradingRetry: { title: 'The assessment check’s answer couldn’t be read', source: 'code', means: 'Its reply wasn’t in the expected format, so plato asked once more.' },
  verdict: { title: 'The assessment check’s verdict', source: 'model', means: 'For each objective, the quote it relied on. plato’s code then looked for each quote in your own messages: a quote counts only if you wrote it, and didn’t copy it from the coach.' },
  recheck: { title: 'Asked the assessment check again', source: 'code', means: 'A quote wasn’t the learner’s own words, so plato asked once more about just that objective.' },
  gradingFailed: { title: 'The assessment check couldn’t run', source: 'code', means: 'The check failed this turn, so nothing new was checked off.' },
  gradingStood: { title: 'The coach’s grading stood', source: 'code', means: 'The check failed on two completing turns in a row, so plato accepted the coach’s grading rather than leave the learner stuck.' },
  verdictApplied: { title: 'What the check changed', source: 'code', means: 'Objectives the coach claimed without backing were taken off; a completion that wasn’t backed up was held.' },
  heldRewrite: { title: 'The coach was asked to reply again', source: 'instructions', means: 'Completion was held, so plato told the coach what was missing and asked for a new reply.' },
  claimCheck: { title: 'Does the reply say the lesson is done?', source: 'code', means: 'With completion held, the reply mustn’t say the lesson is finished. plato checks the wording against known phrases, then asks the model.' },
  replyReplaced: { title: 'plato replaced the coach’s reply', source: 'code', means: 'The reply still said the lesson was done, so plato’s code showed a standard message instead.' },
  positionReplaced: { title: 'plato replaced the “Where you are” note', source: 'code', means: 'The coach’s note said the lesson was done while completion was held.' },
  applied: { title: 'What was recorded, and the rules plato applied', source: 'code', means: 'plato’s code, not the model, decides what is saved: see RULES.' },
  save: { title: 'Saved', source: 'code', means: 'What was written to plato’s database, and whether it worked.' },
  event: { title: 'Reported to the logs', source: 'code', means: 'A short code and the lesson’s id, so the team can count how often this happens. No conversation text.' },
  followUp: { title: 'A follow-up was queued', source: 'code', means: 'Another agent runs in the background after the reply.' },
  followUpStart: { title: 'A follow-up agent ran', source: 'code', means: 'This ran in the background, after the reply it came from.' },
  noteScreened: { title: 'A note was held back', source: 'code', means: 'The note read like an instruction rather than information about the learner, so it wasn’t given to the agent.' },
  profileSaved: { title: 'The learner profile was updated', source: 'code', means: 'plato’s code merged the agent’s result into the profile. Your own notes and your lesson lists are kept as they are.' },
  profileUnchanged: { title: 'The learner profile was not changed', source: 'code', means: 'Nothing usable came back, so the profile stayed as it was.' },
  unitNoteSaved: { title: 'The unit note was updated', source: 'code', means: 'The short note the coach in this unit’s other lessons will see.' },
  unitNoteUnchanged: { title: 'The unit note was not changed', source: 'code', means: 'Nothing usable came back, so the note stayed as it was.' },
  noteChange: { title: 'What you did', source: 'person', means: 'A note you added to or removed from your profile in Settings. Notes you add are kept word for word.' },
  authorInput: { title: 'What you wrote', source: 'person', means: 'Your message in the editing conversation.' },
  authoringOpened: { title: 'plato started the conversation', source: 'code', means: 'The editor opens with a first message that plato’s code writes, so the agent replies first.' },
  authoringTail: { title: 'The conversation so far', source: 'code', means: 'plato sends the agent the last 15 messages of the editing conversation.' },
  authoringParsed: { title: 'What plato read from the reply', source: 'code', means: 'The agent ends each reply with a readiness score from 0 to 10 that only plato’s code reads. You see the text before it, and the score moves the readiness bar.' },
  extractAsked: { title: 'What you asked for', source: 'person', means: 'You asked plato to write the lesson or the knowledge base from the editing conversation: for the preview, or to save it.' },
  extracted: { title: 'What was written, and whether it could be used', source: 'code', means: 'The model wrote the text. plato’s code checked it had what it needs before showing or saving it.' },
  authoringSaved: { title: 'Saved', source: 'code', means: 'Whether what was written reached plato’s database.' },
  shown: { title: 'What you were shown', source: 'code', means: 'The reply that was kept. If a later reply replaced the first, you watched the first one arrive before it changed.' },
  error: { title: 'This attempt failed', source: 'code', means: 'Nothing from this attempt was saved to the conversation.' },
});

/**
 * The rules plato's code applies to a result (ids from
 * lessonTrace.rulesApplied, plus the opener's). All `source: 'code'`.
 */
export const RULES = Object.freeze({
  noProgressTag: 'The reply had no progress score, so the score stayed where it was.',
  clamped: 'The score is kept between 0 and 10, as a whole number.',
  openerCap: 'The opening message can’t finish a lesson: its score is capped at 9.',
  cappedAt9: 'A score of 10 completes the lesson only when every objective is checked off. Until then it is recorded as 9.',
  heldAt8: 'The coach scored 10, but the assessment check couldn’t find every objective in the learner’s own words. Completion was held and the score recorded as at most 8.',
  objectivesNotBackedUp: 'The coach checked off an objective the assessment check couldn’t back up with the learner’s own words, so it wasn’t checked off.',
  checkFailedNothingCounted: 'The assessment check couldn’t run this turn, so nothing new was checked off and a completion waits for the next turn.',
  checkFailedTwiceGradingStood: 'The assessment check couldn’t run on two completing turns in a row, so the coach’s grading was accepted.',
  replyReplaced: 'The coach’s reply said the lesson was done while completion was held, so a standard message was shown instead.',
  frozenAfterCompletion: 'The lesson is complete: the score and the count of exchanges no longer change. Notes still do.',
  notesFolded: 'Only the 10 newest notes are kept in full; older ones are folded into one line.',
  completed: 'Score 10 with every objective checked off: the lesson was marked complete.',
});

/**
 * The numbers behind the rules, by the name the code uses. `where` is the
 * file that owns the value; the test checks every exported scoring or pacing
 * constant appears here.
 */
export const THRESHOLDS = Object.freeze({
  MAX_EXCHANGES: { where: 'client/src/lib/constants.js', means: 'A lesson is designed for about 11 exchanges. Past that the coach is told to wrap up; the lesson is never cut off.' },
  MIN_OBJECTIVES: { where: 'client/src/lib/constants.js', means: 'A lesson has at least 2 objectives.' },
  MAX_OBJECTIVES: { where: 'client/src/lib/constants.js', means: 'A lesson has at most 4 objectives.' },
  MINS_PER_EXCHANGE: { where: 'client/src/lib/constants.js', means: 'Time estimates assume 1.8 minutes per exchange.' },
  HELD_PROGRESS: { where: 'client/src/lib/assessment.js', means: 'A held completion is recorded as at most 8.' },
  DRAFT_WORDS: { where: 'client/src/lib/assessment.js', means: 'A quoted passage of 20 or more words in a reply counts as the coach drafting the learner’s answer.' },
  COPY_WORDS: { where: 'client/src/lib/assessment.js', means: 'A quote of 8 or more words that the coach wrote first doesn’t count as the learner’s.' },
  OWN_SHARE: { where: 'client/src/lib/assessment.js', means: 'A passage the coach wrote first still counts as the learner’s when 70% or more of its words (allowing for spelling slips) were in the learner’s earlier messages: the coach only polished their text.' },
  MAX_TRANSCRIPT: { where: 'client/src/lib/assessment.js', means: 'The assessment check reads the last 40 messages.' },
});

/** The codes the app reports to the server's logs (orchestrator.reportEvent), in plain words. */
export const EVENTS = Object.freeze({
  coach_tags_recovered: 'The coach’s reply was missing its tags and plato got them on a second ask.',
  coach_tags_unrecovered: 'The coach’s reply was missing its tags and the second ask didn’t supply them.',
  conversation_too_long: 'The conversation passed the size limit and can no longer be saved.',
  coach_completion_held: 'A completion was held by the assessment check.',
  coach_objectives_unverified: 'An objective the coach checked off wasn’t backed up.',
  coach_assessment_failed: 'The assessment check couldn’t run.',
  coach_assessment_failed_open: 'The assessment check couldn’t run twice in a row and the coach’s grading stood.',
  coach_draft_rewritten: 'A reply that drafted the learner’s answer was rewritten.',
  coach_draft_kept: 'A reply that drafted the learner’s answer was rewritten, and the rewrite still drafted.',
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
