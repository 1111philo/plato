# How plato works

> Generated from `client/src/lib/transparency.js` by `scripts/generate-how-it-works.js`. Do not edit by hand: change the registry and regenerate.

This is plato’s plain-language description of itself. The Trace view, "Behind this response", the "How assessment works" page and the Privacy page read the same source, so they cannot disagree. For why things are built this way, see [ARCHITECTURE.md](ARCHITECTURE.md).

## Who decides

Every step is marked with who decided it:

- **The AI model.** The model wrote or decided this.
- **plato’s instructions.** A written prompt told the model to do this.
- **plato’s code.** plato’s program did this itself, whatever the model said.
- **A person.** The learner, the lesson’s author, or the classroom team wrote this.

## The AI agents

One AI model does all of this, given different instructions (`client/prompts/<id>.md`).

### Assessor (`assessor`)

A second opinion on grading. For each objective the Coach wants to check off, it must quote the learner’s own words.

- **Runs:** Only on a message where the Coach checks off an objective or scores 10.
- **Is given:** the exemplar and the objectives’ wording; the conversation, labelled by who wrote each message; this message’s images.
- **Returns:** for each objective: shown or not, the quote it relied on, or what is missing.

### Claim Check (`claim-check`)

Answers one question, yes or no: does this reply tell the learner the lesson is done?

- **Runs:** Only when plato has held a completion and the reply’s wording isn’t one plato recognises.
- **Is given:** the Coach’s reply.
- **Returns:** yes or no.

### Coach (`coach`)

Talks with the learner: teaches, asks questions, and reports how far along they are.

- **Runs:** At the start of a lesson and on every message.
- **Is given:** the classroom’s program knowledge base; the list of lessons; the lesson (exemplar, objectives, author’s coach directive); the learner’s profile summary; this lesson’s notes and progress; the last 40 messages; this message’s images and attached pages.
- **Returns:** the reply the learner reads; a progress score from 0 to 10; notes about the learner’s work; which objectives it believes are met; sometimes an observation for the learner’s profile.

### Course Progress Updater (`course-progress-update`)

Keeps a short note of what the learner has shown across a unit’s lessons, so the Coach in the next lesson knows.

- **Runs:** Once, when a lesson that belongs to a unit is completed.
- **Is given:** the unit’s earlier note; this lesson’s notes; the unit’s list of lessons.
- **Returns:** the unit note (about 600 characters).

### Knowledge Base Editor (`knowledge-base-editor`)

Helps a member of the classroom team describe the program by conversation.

- **Runs:** In the Customizer and first-time setup.
- **Is given:** the program knowledge base; the list of lessons; the editing conversation.
- **Returns:** its replies; a readiness score from 0 to 10.

### Knowledge Base Extractor (`knowledge-base-extractor`)

Writes the program knowledge base from the editing conversation.

- **Runs:** When the team member saves the knowledge base.
- **Is given:** the existing knowledge base; the editing conversation.
- **Returns:** the program knowledge base.

### Learner Profile Owner (`learner-profile-owner`)

Updates the learner’s profile from a whole finished lesson.

- **Runs:** Once, when a lesson is completed.
- **Is given:** the current profile; this lesson’s notes and progress.
- **Returns:** an updated profile and a short summary.

### Learner Profile Update (`learner-profile-update`)

Keeps the learner’s profile up to date from one new piece of information.

- **Runs:** When the Coach notes something about the learner, or the learner adds or removes a note in Settings.
- **Is given:** the current profile; the new observation or note.
- **Returns:** an updated profile and a short summary.

### Lesson Creator (`lesson-creator`)

Helps a member of the classroom team design a lesson by conversation.

- **Runs:** In the lesson editor.
- **Is given:** the program knowledge base; the list of lessons, including private ones; the editing conversation.
- **Returns:** its replies; a readiness score from 0 to 10.

### Lesson Extractor (`lesson-extractor`)

Writes the lesson itself from the editing conversation.

- **Runs:** When the team member refreshes the lesson preview or creates the lesson.
- **Is given:** the editing conversation.
- **Returns:** the lesson: name, description, exemplar, objectives, optional coach directive.

### Lesson Owner (`lesson-owner`)

Sets up this learner’s copy of the lesson: restates each objective with what would count as evidence.

- **Runs:** Once, when the lesson starts.
- **Is given:** the lesson as the author wrote it; the learner’s profile summary.
- **Returns:** the objectives and evidence the Coach and the Assessor use; a copy of the exemplar; a starting note on where the learner is.

## What an agent’s instructions are made of

| Part | Written by | What it is |
|---|---|---|
| The agent’s instructions | plato’s instructions | Written by plato’s developers; the same for everyone. Public in plato’s source code. |
| Program knowledge base | A person | Written by your classroom team to describe the program. |
| Lessons in this classroom | plato’s code | The names of the lessons you can see, listed by plato’s code. |
| The agent’s instructions (final part) | plato’s instructions | The last rules the model reads, placed after the classroom’s material so they aren’t lost. |
| A one-time addition from plato | plato’s code | plato’s code added this instruction for this one call (for example, when asking the coach to write a reply again). |
| Language | plato’s code | Added because your browser’s language isn’t English: write in that language, keep plato’s tags in English. |

## What the coach is told before every reply

| Field | Written by | Where it comes from |
|---|---|---|
| Your first name (`learnerName`) | A person | Your account. |
| Lesson name (`lessonName`) | A person | The lesson, as its author wrote it. |
| Lesson description (`lessonDescription`) | A person | The lesson, as its author wrote it. |
| What finished work looks like (`exemplar`) | The AI model | The Lesson Owner’s copy of the author’s exemplar, made when the lesson started. |
| Lesson status (`lessonStatus`) | plato’s code | Active, or completed. |
| Objectives and what counts as evidence (`objectives`) | The AI model | The Lesson Owner’s version of the author’s objectives, made when the lesson started. |
| Objectives checked off so far (`objectivesMet`) | plato’s code | Kept by plato’s code; an objective stays checked off once it is. |
| The coach’s notes on your work (`insights`) | The AI model | Written by the coach on earlier messages in this lesson. |
| Your profile summary (`learnerProfile`) | The AI model | Written by the Learner Profile Update from earlier lessons and your own notes. |
| Where you are (`learnerPosition`) | The AI model | The coach’s latest one-line note on where you stand in this lesson. |
| Progress so far (`progress`) | plato’s code | The score on record, 0 to 10. |
| Exchanges so far (`activitiesCompleted`) | plato’s code | Counted by plato’s code, one per message until the lesson is complete. |
| The author’s instructions to the coach (`coachDirective`) | A person | The lesson’s optional Coach Directive section. |
| Unit, and what you’ve shown in its other lessons (`unit`) | The AI model | The unit’s name, with the note the Course Progress Updater keeps. |
| Course (`course`) | A person | The course this lesson’s unit belongs to. |
| Background from plugins (`enrichmentContext`) | plato’s code | Gathered once when the lesson started, by plugins the classroom turned on. |
| A pacing instruction (`pacingDirective`) | plato’s code | Added by plato’s code once the lesson runs past its usual length, telling the coach to move toward wrapping up. The lesson is never cut off. |
| An instruction for after completion (`postCompletionDirective`) | plato’s code | Added by plato’s code once the lesson is complete: the conversation is for feedback, and the score no longer changes. |

## The rules plato’s code applies

The model suggests; plato’s code decides what is recorded. These apply whatever the model says.

- **`noProgressTag`** The reply had no progress score, so the score stayed where it was.
- **`clamped`** The score is kept between 0 and 10, as a whole number.
- **`openerCap`** The opening message can’t finish a lesson: its score is capped at 9.
- **`cappedAt9`** A score of 10 completes the lesson only when every objective is checked off. Until then it is recorded as 9.
- **`heldAt8`** The coach scored 10, but the Assessor couldn’t find every objective in the learner’s own words. Completion was held and the score recorded as at most 8.
- **`objectivesNotBackedUp`** The coach checked off an objective the Assessor couldn’t back up with the learner’s own words, so it wasn’t checked off.
- **`checkFailedNothingCounted`** The Assessor couldn’t run this turn, so nothing new was checked off and a completion waits for the next turn.
- **`checkFailedTwiceGradingStood`** The Assessor couldn’t run on two completing turns in a row, so the coach’s grading was accepted.
- **`replyReplaced`** The coach’s reply said the lesson was done while completion was held, so a standard message was shown instead.
- **`frozenAfterCompletion`** The lesson is complete: the score and the count of exchanges no longer change. Notes still do.
- **`notesFolded`** Only the 10 newest notes are kept in full; older ones are folded into one line.
- **`completed`** Score 10 with every objective checked off: the lesson was marked complete.

### The numbers behind them

| Name | Meaning | Defined in |
|---|---|---|
| `MAX_PROGRESS` | Progress runs from 0 to 10; 10 with every objective checked off completes a lesson. | `client/src/lib/constants.js` |
| `MAX_INSIGHTS` | The coach’s 10 newest notes are kept in full. | `client/src/lib/constants.js` |
| `MAX_EXCHANGES` | A lesson is designed for about 11 exchanges. Past that the coach is told to wrap up; the lesson is never cut off. | `client/src/lib/constants.js` |
| `MIN_OBJECTIVES` | A lesson has at least 2 objectives. | `client/src/lib/constants.js` |
| `MAX_OBJECTIVES` | A lesson has at most 4 objectives. | `client/src/lib/constants.js` |
| `MINS_PER_EXCHANGE` | Time estimates assume 1.8 minutes per exchange. | `client/src/lib/constants.js` |
| `HELD_PROGRESS` | A held completion is recorded as at most 8. | `client/src/lib/assessment.js` |
| `DRAFT_WORDS` | A quoted passage of 20 or more words in a reply counts as the coach drafting the learner’s answer. | `client/src/lib/assessment.js` |
| `COPY_WORDS` | A quote of 8 or more words that the coach wrote first doesn’t count as the learner’s. | `client/src/lib/assessment.js` |
| `COPIED_SHARE` | Nor does a quote mostly in the coach’s wording: when more than 50% of its three-word phrases appeared first in the coach’s messages (its sentences joined up, or sent back with a word swapped). The coach polishing the learner’s own words still counts as theirs. | `client/src/lib/assessment.js` |
| `OWN_SHARE` | A passage the coach wrote first still counts as the learner’s when 70% or more of its words (allowing for spelling slips) were in the learner’s earlier messages: the coach only polished their text. | `client/src/lib/assessment.js` |
| `MAX_TRANSCRIPT` | The Assessor reads the last 40 messages. | `client/src/lib/assessment.js` |

## What a Trace records

With Trace on for a conversation, each exchange of it is recorded step by step. The Trace shows the steps grouped in these stages, in this order:

1. **plato set up the lesson.** Once, when a lesson starts: the lesson as written, the Lesson Owner’s version of it, and anything plugins added.
2. **You sent.** What you wrote or did, exactly as plato received it.
3. **plato prepared and sent the request.** plato’s code gathers the conversation so far and what it knows about you and the lesson, then sends it to the AI model.
4. **The AI model answered.** The request to the model, its raw reply, and what plato read from it.
5. **plato checked the answer.** Checks plato runs on the model’s answer, and what they changed.
6. **plato recorded the result.** What was saved, the rules plato’s code applied, and what was reported to the logs.
7. **In the background.** Other agents that ran after the reply, and what they changed.

| Step | Stage | Decided by | Meaning |
|---|---|---|---|
| The lesson (`lesson`) | plato set up the lesson | A person | The lesson as its author wrote it, and when it was last edited. |
| The Lesson Owner’s setup (`planned`) | plato set up the lesson | The AI model | The Lesson Owner, an AI helper, restated the author’s objectives with what would count as evidence. The coach and the Assessor use this version, not the author’s wording. |
| plato checked the Lesson Owner’s setup (`validation`) | plato set up the lesson | plato’s code | plato’s code checked the setup had everything the coach and the Assessor need (the exact list is shown). If not, it asked once more and used the second answer. |
| Extra context from plugins (`plugins`) | plato set up the lesson | plato’s code | Plugins the classroom has turned on can add background for the coach when a lesson starts. Each plugin’s own work is listed with it: the AI calls it made, the outside requests it sent, and its notes. |
| What you sent (`input`) | You sent | A person | Your message, with any images and attached web pages. |
| Where the lesson stood (`state`) | plato prepared and sent the request | plato’s code | The progress and objectives on record before this message. |
| The conversation so far (`tail`) | plato prepared and sent the request | plato’s code | plato sends the latest messages, up to a limit. Images and attached pages from earlier messages are not sent again. |
| What plato told the coach (`context`) | plato prepared and sent the request | plato’s code | Before every reply plato’s code gathers what the coach should know about you and the lesson, and sends it as the first message. |
| The messages sent to the model (`history`) | plato prepared and sent the request | plato’s code | The exact list of messages every coach call on this turn starts from. |
| A call to the AI model (`call`) | The AI model answered | The AI model | One request to the model and its raw reply. |
| What plato read from the reply (`parsed`) | The AI model answered | plato’s code | The coach ends each reply with tags that only plato’s code reads. You see the text before them. |
| Were the reply’s tags there? (`tagCheck`) | plato checked the answer | plato’s code | plato’s code looks for the tags it needs. Without them, nothing from the reply can be recorded. |
| Did the reply write the answer for you? (`draftCheck`) | plato checked the answer | plato’s code | plato’s code looks for a long quoted passage, or wording like “here’s a draft”, which would mean the coach wrote what you should write yourself. |
| What the second request got back (`tagRepair`) | plato checked the answer | plato’s instructions | The coach left off its tags, so plato asked it for just the tags of the reply it gave. |
| The coach wrote your answer for you (`draftGuard`) | plato checked the answer | plato’s instructions | The first reply drafted the learner’s answer. plato asked the coach to give feedback and a question instead, and showed that reply. |
| The author’s link or code, exactly (`literals`) | plato checked the answer | plato’s code | The reply changed a link or code from the lesson author’s instructions slightly, so plato’s code put back the author’s exact text. |
| Was the reply in one language? (`scriptCheck`) | plato checked the answer | plato’s code | plato’s code looks for characters from a script your language doesn’t use, such as Chinese characters in an English reply, or for a reply that isn’t in your language’s own script (Bengali, Hindi, Arabic and others). |
| The reply mixed in another language (`scriptGuard`) | plato checked the answer | plato’s instructions | plato asked the coach to write the same reply again in your language, and showed the rewrite if it came back clean. |
| Whether to check the grading (`gradingPlan`) | plato checked the answer | plato’s code | The Assessor runs only when the coach checks off an objective or scores 10. |
| The Assessor’s answer couldn’t be read (`gradingRetry`) | plato checked the answer | plato’s code | Its reply wasn’t in the expected format, so plato asked once more. |
| The Assessor’s verdict (`verdict`) | plato checked the answer | The AI model | For each objective, the quote it relied on. plato’s code then looked for each quote in your own messages: a quote counts only if you wrote it, and didn’t copy it from the coach. |
| Asked the Assessor again (`recheck`) | plato checked the answer | plato’s code | A quote wasn’t the learner’s own words, so plato asked once more about just that objective. |
| The Assessor couldn’t run (`gradingFailed`) | plato checked the answer | plato’s code | The check failed this turn, so nothing new was checked off. |
| The coach’s grading stood (`gradingStood`) | plato checked the answer | plato’s code | The check failed on two completing turns in a row, so plato accepted the coach’s grading rather than leave the learner stuck. |
| What the check changed (`verdictApplied`) | plato checked the answer | plato’s code | Objectives the coach claimed without backing were taken off; a completion that wasn’t backed up was held. |
| The coach was asked to reply again (`heldRewrite`) | plato checked the answer | plato’s instructions | Completion was held, so plato told the coach what was missing and asked for a new reply. |
| Does the reply say the lesson is done? (`claimCheck`) | plato checked the answer | plato’s code | With completion held, the reply mustn’t say the lesson is finished. plato checks the wording against known phrases, then asks the model. |
| plato replaced the coach’s reply (`replyReplaced`) | plato checked the answer | plato’s code | The reply still said the lesson was done, so plato’s code showed a standard message instead. |
| plato replaced the “Where you are” note (`positionReplaced`) | plato checked the answer | plato’s code | The coach’s note said the lesson was done while completion was held. |
| What was recorded, and the rules plato applied (`applied`) | plato recorded the result | plato’s code | plato’s code, not the model, decides what is saved: see RULES. |
| Saved (`save`) | plato recorded the result | plato’s code | What was written to plato’s database, and whether it worked. |
| Reported to the logs (`event`) | plato recorded the result | plato’s code | A short code and the lesson’s id, so the team can count how often this happens. No conversation text. |
| A follow-up was queued (`followUp`) | In the background | plato’s code | Another agent runs in the background after the reply. |
| A follow-up agent ran (`followUpStart`) | In the background | plato’s code | This ran in the background, after the reply it came from. |
| A note was held back (`noteScreened`) | plato checked the answer | plato’s code | The note read like an instruction rather than information about the learner, so it wasn’t given to the agent. |
| The learner profile was updated (`profileSaved`) | plato recorded the result | plato’s code | plato’s code merged the agent’s result into the profile. Your own notes and your lesson lists are kept as they are. |
| The learner profile was not changed (`profileUnchanged`) | plato recorded the result | plato’s code | Nothing usable came back, so the profile stayed as it was. |
| The unit note was updated (`unitNoteSaved`) | In the background | plato’s code | The short note the coach in this unit’s other lessons will see. |
| The unit note was not changed (`unitNoteUnchanged`) | In the background | plato’s code | Nothing usable came back, so the note stayed as it was. |
| What you did (`noteChange`) | You sent | A person | A note you added to or removed from your profile in Settings. Notes you add are kept word for word. |
| What you were shown (`shown`) | plato recorded the result | plato’s code | The reply that was kept. If a later reply replaced the first, you watched the first one arrive before it changed. |
| This attempt failed (`error`) | plato recorded the result | plato’s code | Nothing from this attempt was saved to the conversation. |

## What is reported to the server’s logs

A code and the lesson’s id. Never conversation text.

- `coach_tags_recovered`: The coach’s reply was missing its tags and plato got them on a second ask.
- `coach_tags_unrecovered`: The coach’s reply was missing its tags and the second ask didn’t supply them.
- `conversation_too_long`: The conversation passed the size limit and can no longer be saved.
- `coach_completion_held`: A completion was held by the Assessor.
- `coach_objectives_unverified`: An objective the coach checked off wasn’t backed up.
- `coach_assessment_failed`: The Assessor couldn’t run.
- `coach_assessment_failed_open`: The Assessor couldn’t run twice in a row and the coach’s grading stood.
- `coach_draft_rewritten`: A reply that drafted the learner’s answer was rewritten.
- `coach_draft_kept`: A reply that drafted the learner’s answer was rewritten, and the rewrite still drafted.
- `coach_script_rewritten`: A reply that mixed in characters from another language (such as Chinese in an English reply) was rewritten.
- `coach_script_kept`: A reply that mixed in another language was rewritten, and the rewrite still did, so the reply was kept.
- `coach_literal_restored`: A reply changed a link or code from the lesson author’s instructions slightly; plato put back the author’s exact text.

## Outside services, and what each is sent

plato has no analytics or tracking.

| Service | Role | Used | What it is sent |
|---|---|---|---|
| Amazon Bedrock | Runs the AI model. | always | Each AI call: the agent’s instructions, the context plato assembled, the recent conversation, and this message’s images and attached page text. Amazon does not use prompts or replies to train models. |
| Qwen3-VL 235B | The AI model behind every agent. | always | Reached through Amazon Bedrock. Open source (Apache-2.0 licence), made by Alibaba Cloud’s Qwen team, run by Amazon. |
| Amazon DynamoDB | plato’s database. | always | Accounts, lessons, conversations, images, profiles, and traces. |
| AWS Lambda and API Gateway | Run plato’s server code. | always | Every request to plato passes through them. |
| Amazon CloudFront and AWS WAF | Deliver the app and screen incoming traffic. | always | Every request to plato passes through them. |
| Amazon CloudWatch Logs | plato’s error log. | always | Error codes with a user id and lesson id. Never conversation text. |
| Amazon SES | Sends plato’s email. | always | Invites, password resets, reminders and digests: your email address, name, and lesson names. Never conversation text. |
| AWS Systems Manager | Holds the server’s settings. | always | Nothing about learners. |
| Web pages you attach | plato’s server reads a page you attach to a message. | when a learner attaches a link | A request for that page from plato’s server. The site doesn’t learn who you are. |
| Your institution’s sign-in (Microsoft Entra) | Signs you in with your institution account. | when the classroom turns on single sign-on | A sign-in request. plato receives your name, email and an id; nothing about your lessons is sent. |
| Slack | Invites and links classroom members. | when the classroom connects Slack | Email addresses, to find or invite members. Never lesson content. |
| WordPress.org and GitHub | Background for lessons about WordPress. | when the classroom turns on the WordPress Info plugin | Search terms written from the lesson (not from your messages) to developer.wordpress.org, make.wordpress.org and api.github.com. |
