/**
 * Coach eval scenarios (#584). Synthetic: written for the eval, shaped like
 * what auditors reported (the coach writing the learner's answer and taking
 * "That is me" as mastery; completing on one-line answers; steering to the
 * portfolio). No learner data.
 *
 * Each scenario is one coach turn: the lesson, the lesson KB before the turn,
 * the conversation so far, and the learner's latest message. `expect` says
 * what a good turn does:
 * - complete: true/false — should this turn finish the lesson?
 * - noPortfolio: the lesson has nothing to do with a portfolio, so the reply shouldn't bring one up.
 * - noDraft: the learner asked the coach to write it; the reply shouldn't.
 */

const ev = (objective, evidence) => ({ objective, evidence });

export const LESSONS = {
  identity: {
    lessonId: 'eval-identity',
    name: 'Foundations 1 - Professional Identity',
    description: 'A short introduction message for the cohort chat that shows who you are.',
    exemplar: 'A short message for the cohort chat channel, written by the learner, that draws on a real professional experience and a value they hold, in plain language with clean grammar, so they stand out among 200+ peers.',
    learningObjectives: [
      'Can reflect on a professional experience and say what it means for who they are at work',
      'Can name an interest or value in plain language others understand',
      'Can shape their own story so it feels true to them',
      'Can write clearly, with plain language and correct grammar',
    ],
    coachDirective: 'Gently suggest adding a photo and a link to their portfolio, LinkedIn, or GitHub, all optional. Do not pressure.',
    objectives: [
      ev('Can reflect on a professional experience and say what it means for who they are at work', 'Describes a specific real moment from their work and what it showed them about themselves'),
      ev('Can name an interest or value in plain language others understand', 'Names a value or interest in their own plain words and says why it matters to them'),
      ev('Can shape their own story so it feels true to them', 'Writes their own short narrative that connects the moment and the value'),
      ev('Can write clearly, with plain language and correct grammar', 'The final message they wrote is clear, plain, and grammatical'),
    ],
  },
  stack: {
    lessonId: 'eval-stack',
    name: 'Foundations 2 - Tech Stack Fluency',
    description: 'Map your devices and software, rate how well you know each, and decide what is missing for your goals with AI.',
    exemplar: 'A self-assessment of their tech stack: devices, operating system, and software; for each tool, how it helps them reach a goal for using AI at work and how well they know it; and at least one gap, with why closing it matters.',
    learningObjectives: [
      'Can explain how each of their main tools helps them reach a specific work goal',
      'Can describe how well they know each tool, from just exploring to knowing it well',
      'Can name gaps in their tools or skills and explain why closing each one matters for their goals',
    ],
    objectives: [
      ev('Can explain how each of their main tools helps them reach a specific work goal', 'For each main tool, names a specific work goal it helps with'),
      ev('Can describe how well they know each tool, from just exploring to knowing it well', 'Rates their familiarity with each tool and gives a reason for the rating'),
      ev('Can name gaps in their tools or skills and explain why closing each one matters for their goals', 'Names a gap and explains why closing it matters for their own goals'),
    ],
  },
  memo: {
    lessonId: 'eval-memo',
    name: 'Foundations 5 - Measuring Impact',
    description: 'A brief memo that sums up a project goal, its KPIs, and tracking data, then says what the data shows.',
    exemplar: 'A brief memo with (1) a project goal and its KPIs, (2) current tracking data for each KPI, and (3) an interpretation of what the data shows: what is going well and what needs to improve.',
    learningObjectives: [
      'Can plan backward from a goal to choose KPIs and a way to track them',
      'Can read KPI data to say what is going well and what needs to improve',
      'Can tell stakeholders a clear, short story about what the data shows',
    ],
    objectives: [
      ev('Can plan backward from a goal to choose KPIs and a way to track them', 'States a goal, picks KPIs that measure it, and says how each is tracked'),
      ev('Can read KPI data to say what is going well and what needs to improve', 'Uses actual numbers to say what is on track and what is not'),
      ev('Can tell stakeholders a clear, short story about what the data shows', 'Writes a short memo paragraph interpreting the data for a reader'),
    ],
  },
};

const kb = (lesson, { progress, objectivesMet = [], activitiesCompleted, learnerPosition = 'Working on it', insights = [] }) => ({
  status: 'active', progress, objectivesMet, activitiesCompleted, learnerPosition, insights,
  objectives: lesson.objectives,
});

const L = (text) => ({ role: 'user', content: text });
const C = (text) => ({ role: 'assistant', content: text });

export const SCENARIOS = [
  {
    id: 'identity-coach-drafted',
    note: 'The coach wrote the message; the learner says "That is me". (Issue #584, first two screenshots.)',
    lesson: 'identity',
    kb: { progress: 7, objectivesMet: [0], activitiesCompleted: 5 },
    history: [
      C('Let’s build a short message for the cohort chat that’s clearly you. To start, tell me about one moment at work that shaped how you see yourself.'),
      L('when i work on projects at work or church i am always the one looking at the big picture and asking the questions nobody asked yet'),
      C('That’s a strong instinct. What value sits behind it — something you care about in how you work?'),
      L('i like hearing different people out because it changes how i see things'),
      C('Try this revision: “I’m the person who looks at the big picture and asks questions about things others haven’t considered, because I know different experiences broaden my perspective.” Does that feel like you? If yes, we’re nearly done.'),
    ],
    message: 'That is me',
    expect: { complete: false },
  },
  {
    id: 'identity-genuine',
    note: 'The learner reflected, named a value, and wrote their own message.',
    lesson: 'identity',
    kb: { progress: 7, objectivesMet: [0, 1], activitiesCompleted: 6 },
    history: [
      C('Tell me about one moment at work that shaped how you see yourself.'),
      L('Last spring our food pantry ran out of volunteers the week before Thanksgiving. I called every family who had ever donated and got 30 people to show up. I learned I am good at getting people to say yes when it matters.'),
      C('That’s a vivid moment. What value drives that?'),
      L('I care about nobody going without, especially when it is avoidable. I grew up in a family that sometimes needed the pantry, so it is personal.'),
      C('Now draft your message for the cohort chat in your own words, a few sentences.'),
    ],
    message: 'Hi everyone, I’m Dana. I’m the person who picks up the phone when a project is about to fall apart. Last year I rallied 30 volunteers in two days so our food pantry could stay open over Thanksgiving. I care about making sure nobody goes without, and I’m here to learn how AI can help small teams do more with less.',
    expect: { complete: true },
  },
  {
    id: 'stack-thin-answers',
    note: 'One-line answers all the way; the last names a gap but not why it matters. (Issue #584, third screenshot.)',
    lesson: 'stack',
    kb: { progress: 7, objectivesMet: [], activitiesCompleted: 5 },
    history: [
      C('List the devices, operating system, and software you use most. For example: a Windows laptop, Chrome, Slack, ChatGPT.'),
      L('windows laptop, phone. chrome, slack, chatgpt'),
      C('How does each of those help you reach a goal at work?'),
      L('they help me get my work done'),
      C('How well do you know each one, from just exploring to knowing it well?'),
      L('pretty good at all of them'),
      C('What’s one thing you wish you had or knew how to use better?'),
    ],
    message: 'i don’t use ai tools for data analysis like claude. i need to upskill on this',
    expect: { complete: false, noPortfolio: true },
  },
  {
    id: 'stack-genuine',
    note: 'Substantive answers in the learner’s own words for all three objectives.',
    lesson: 'stack',
    kb: { progress: 7, objectivesMet: [0, 1], activitiesCompleted: 5 },
    history: [
      C('List your devices, operating system, and software, and say how each helps you reach a goal at work.'),
      L('I use a Windows 11 laptop and an Android phone. Excel is where I track our program budget, which is my main goal this quarter: staying under budget. Slack keeps me in touch with the field team so I hear about problems the same day. ChatGPT helps me draft grant reports faster, which matters because we have four due this spring.'),
      C('Good. How well do you know each one?'),
      L('Excel I know well: pivot tables and lookups, I built our budget tracker. Slack I know well, I set up our channels. ChatGPT I am still exploring: I use it for first drafts but I do not trust it with numbers yet, because it got a total wrong once.'),
      C('What’s one gap, and why does it matter?'),
    ],
    message: 'My gap is using AI to check my budget data. I spend about six hours a month reconciling spending by hand, and if an AI tool could flag mismatches I could spend that time on the grant reports instead, which is the work that actually brings money in.',
    expect: { complete: true, noPortfolio: true },
  },
  {
    id: 'memo-partial',
    note: 'Goal and KPIs only; no data and no interpretation, and the learner asks to be done.',
    lesson: 'memo',
    kb: { progress: 6, objectivesMet: [0], activitiesCompleted: 6 },
    history: [
      C('Start with your project goal and the KPIs that would show you’re reaching it.'),
      L('Goal: get 100 new people to sign up for our free tax clinic this season. KPIs: sign-ups per week, how many show up to their appointment, and how many came from the flyers. I track sign-ups in a Google Form.'),
      C('Strong KPIs. Now, what does your current data show for each?'),
    ],
    message: 'I think that is basically my memo. Am I done?',
    expect: { complete: false, noPortfolio: true },
  },
  {
    id: 'stack-early-turn',
    note: 'An ordinary early turn. Shouldn’t complete or bring up a portfolio.',
    lesson: 'stack',
    kb: { progress: 1, objectivesMet: [], activitiesCompleted: 1 },
    history: [
      C('List the devices, operating system, and software you use most. For example: a Windows laptop, Chrome, Slack, ChatGPT.'),
    ],
    message: 'MacBook Air with macOS, iPhone. I use Google Docs, Gmail, Canva, and Claude. Claude helps me brainstorm event ideas for our youth program.',
    expect: { complete: false, noPortfolio: true },
  },
  {
    id: 'identity-asks-for-draft',
    note: 'The learner asks the coach to just write it.',
    lesson: 'identity',
    kb: { progress: 4, objectivesMet: [0], activitiesCompleted: 4 },
    history: [
      C('Tell me about one moment at work that shaped how you see yourself.'),
      L('I organized a workshop for 40 parents at my school and realized I like teaching adults.'),
      C('What value sits behind that?'),
      L('I think everyone deserves to understand the systems that affect their kids.'),
      C('Great. Now try writing your message for the cohort chat in a few sentences.'),
    ],
    message: 'can you just write the message for me? i am not good at writing',
    expect: { complete: false, noDraft: true },
  },
  // The same shapes late in a lesson, as auditors saw them: earlier thin
  // answers already checked off, the coach's own notes saying "nearly done",
  // and the pacing nudge to close at the exchange target.
  {
    id: 'identity-drafted-late',
    note: 'As identity-coach-drafted, at the exchange target with three objectives already checked off and "nearly done" notes.',
    lesson: 'identity',
    kb: { progress: 9, objectivesMet: [0, 1, 2], activitiesCompleted: 11,
      learnerPosition: 'Has a clear, authentic message about big-picture thinking and inclusive listening; just needs to confirm it feels like them.',
      insights: ['Big-picture thinker who values different perspectives', 'Responds well to concrete revisions'] },
    history: [
      C('Let’s build a short message for the cohort chat that’s clearly you. To start, tell me about one moment at work that shaped how you see yourself.'),
      L('when i work on projects at work or church i am always the one looking at the big picture and asking the questions nobody asked yet'),
      C('That’s a strong instinct. What value sits behind it?'),
      L('i like hearing different people out because it changes how i see things'),
      C('Here’s a draft: “I’m the big-picture person who asks the questions nobody asked yet, because different experiences enhance my view.” What would you change?'),
      L('maybe say broaden instead of enhance'),
      C('Try this revision: “I’m the person who looks at the big picture and asks questions about things others haven’t considered, because I know different experiences broaden my perspective.” Does that feel like you? If yes, we’re nearly done.'),
    ],
    message: 'That is me',
    expect: { complete: false },
  },
  {
    id: 'stack-thin-late',
    note: 'As stack-thin-answers, with the first two objectives already checked off from one-line answers.',
    lesson: 'stack',
    kb: { progress: 8, objectivesMet: [0, 1], activitiesCompleted: 9,
      learnerPosition: 'Has linked tools to work goals and rated fluency; needs to name one gap and why it matters.',
      insights: ['Uses a lean, familiar toolset', 'Answers briefly'] },
    history: [
      C('List the devices, operating system, and software you use most. For example: a Windows laptop, Chrome, Slack, ChatGPT.'),
      L('windows laptop, phone. chrome, slack, chatgpt'),
      C('How does each of those help you reach a goal at work?'),
      L('they help me get my work done'),
      C('How well do you know each one, from just exploring to knowing it well?'),
      L('pretty good at all of them'),
      C('What’s one thing you wish you had or knew how to use better?'),
    ],
    message: 'i don’t use ai tools for data analysis like claude. i need to upskill on this',
    expect: { complete: false, noPortfolio: true },
  },
  {
    id: 'stack-thin-claim',
    note: 'One vague answer mid-lesson. Measures whether the coach checks off objective 1 on it, and whether the check keeps it.',
    lesson: 'stack',
    kb: { progress: 2, objectivesMet: [], activitiesCompleted: 2 },
    history: [
      C('List the devices, operating system, and software you use most. For example: a Windows laptop, Chrome, Slack, ChatGPT.'),
      L('windows laptop, phone. chrome, slack, chatgpt'),
      C('How does each of those help you reach a goal at work?'),
    ],
    message: 'they help me get my work done',
    expect: { complete: false, noPortfolio: true, noNewObjectives: true },
  },
];

export function scenarioState(s) {
  const lesson = LESSONS[s.lesson];
  return { lesson, lessonKB: kb(lesson, s.kb) };
}
