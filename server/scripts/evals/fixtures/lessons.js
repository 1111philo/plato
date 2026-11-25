/**
 * The test lessons (docs/AGENT_EVALS.md section 2), one for each kind of work
 * plato's lessons ask for. Written for testing, modelled on real lessons; no
 * learner data. L1–L3 are the Coach eval's lessons (#584).
 *
 * Each has what the author writes (`learningObjectives`, `exemplar`,
 * `coachDirective`) and the Lesson Owner's per-learner version the Coach and
 * Assessor work from (`objectives`, each with what would count as evidence).
 */
const ev = (objective, evidence) => ({ objective, evidence });
const lesson = (id, name, description, exemplar, objectives, extra = {}) => ({
  lessonId: `eval-${id.toLowerCase()}`, name, description, exemplar,
  learningObjectives: objectives.map((o) => o.objective), objectives, ...extra,
});

export const LESSONS = {
  L1: lesson('L1', 'Foundations 1 - Professional Identity', 'A short introduction message for the cohort chat that shows who you are.',
    'A short message for the cohort chat channel, written by the learner, that draws on a real professional experience and a value they hold, in plain language with clean grammar, so they stand out among 200+ peers.',
    [
      ev('Can reflect on a professional experience and say what it means for who they are at work', 'Describes a specific real moment from their work and what it showed them about themselves'),
      ev('Can name an interest or value in plain language others understand', 'Names a value or interest in their own plain words and says why it matters to them'),
      ev('Can shape their own story so it feels true to them', 'Writes their own short narrative that connects the moment and the value'),
      ev('Can write clearly, with plain language and correct grammar', 'The final message they wrote is clear, plain, and grammatical'),
    ],
    { coachDirective: 'Gently suggest adding a photo and a link to their portfolio, LinkedIn, or GitHub, all optional. Do not pressure.' }),
  L2: lesson('L2', 'Foundations 2 - Tech Stack Fluency', 'Map your devices and software, rate how well you know each, and decide what is missing for your goals with AI.',
    'A self-assessment of their tech stack: devices, operating system, and software; for each tool, how it helps them reach a goal for using AI at work and how well they know it; and at least one gap, with why closing it matters.',
    [
      ev('Can explain how each of their main tools helps them reach a specific work goal', 'For each main tool, names a specific work goal it helps with'),
      ev('Can describe how well they know each tool, from just exploring to knowing it well', 'Rates their familiarity with each tool and gives a reason for the rating'),
      ev('Can name gaps in their tools or skills and explain why closing each one matters for their goals', 'Names a gap and explains why closing it matters for their own goals'),
    ]),
  L3: lesson('L3', 'Foundations 5 - Measuring Impact', 'A brief memo that sums up a project goal, its KPIs, and tracking data, then says what the data shows.',
    'A brief memo with (1) a project goal and its KPIs, (2) current tracking data for each KPI, and (3) an interpretation of what the data shows: what is going well and what needs to improve.',
    [
      ev('Can plan backward from a goal to choose KPIs and a way to track them', 'States a goal, picks KPIs that measure it, and says how each is tracked'),
      ev('Can read KPI data to say what is going well and what needs to improve', 'Uses actual numbers to say what is on track and what is not'),
      ev('Can tell stakeholders a clear, short story about what the data shows', 'Writes a short memo paragraph interpreting the data for a reader'),
    ]),
  L4: lesson('L4', 'Success Skills 1 - Living Wages', 'Make a plan to reach a living wage where you live.',
    'A one-page plan with a target living wage for their area, three steps toward it with dates, and one trade-off they are willing to make.',
    [
      ev('Can find the living wage for where they live and set a target', 'States a living-wage figure for their area and where it came from'),
      ev('Can plan concrete steps toward the target', 'Lists three dated steps that are specific to them'),
      ev('Can weigh a trade-off honestly', 'Names one trade-off and why they accept it'),
    ]),
  L5: lesson('L5', 'AI Leadership 1 - Generative AI Fundamentals', 'Explain how an AI tool produces an answer.',
    'An explanation, in their own words or a labelled diagram, of how a generative AI tool turns a prompt into an answer, using a real example from their own use.',
    [
      ev('Can explain how a generative AI tool produces an answer', 'Explains prediction from training data in their own words'),
      ev('Can connect the idea to a real example from their own use', 'Describes one real prompt they used and what the tool did'),
    ]),
  L6: lesson('L6', 'AI Leadership 7 - Ethics Checklist', 'Build an ethics checklist for using AI at work.',
    'A screenshot of an AI-use checklist they built (at least five items), with a short explanation of the two items that matter most to them.',
    [
      ev('Can build a practical checklist for using AI responsibly', 'Shares a screenshot of a checklist with at least five items'),
      ev('Can explain which checks matter most and why', 'Explains two items and why they matter in their work'),
    ]),
  L7: lesson('L7', 'Job Placement 1 - Your Web Presence', 'Publish a simple page that introduces you professionally.',
    'A live web page they made, shared as a link, with a headline, a short bio, and one way to contact them.',
    [
      ev('Can publish a simple professional page', 'Shares a working link to a page they made'),
      ev('Can present themselves clearly on the page', 'The page has a headline, a short bio and a contact'),
    ]),
  L8: lesson('L8', 'WordPress 2 - Plugins in the Wild', 'Research a real site that uses a plugin well.',
    'A short description of a real website that uses a WordPress plugin well, what the plugin does there, and where they found it.',
    [
      ev('Can find a real example of a plugin in use', 'Names a real site and the plugin it uses'),
      ev('Can explain what the plugin does for that site', 'Describes what the plugin does there in their own words'),
      ev('Can say where their information came from', 'Names the source or link they used'),
    ]),
  L9: lesson('L9', 'Foundations 0 - Orientation', 'Get set up and reflect on why you are here.',
    'A screenshot showing their completed profile setup, and a short reflection on what they hope to get from the program.',
    [
      ev('Can complete their program setup', 'Shares a screenshot of the completed setup'),
      ev('Can say what they hope to get from the program', 'Writes a short, personal reflection'),
    ]),
  L10: lesson('L10', 'Job Placement 7 - Opportunity Tracker', 'Add this week\'s opportunities to the tracker you started earlier in the unit.',
    'Their opportunity spreadsheet from earlier lessons with five new opportunities added, each with a deadline and a next step.',
    [
      ev('Can add new opportunities to their tracker', 'Adds five new rows, each with a deadline'),
      ev('Can plan a next step for each', 'Each new row has a concrete next step'),
    ],
    { unit: 'Job Placement', course: 'AI Leaders' }),
  L11: lesson('L11', 'Getting Started - Your Learner Profile', 'The coach drafts your learner profile from your answers; you confirm it.',
    'A learner profile the learner has confirmed is accurate, drafted by the coach from the learner\'s answers about their goals, background and how they like to learn.',
    [
      ev('Can describe their goals and background', 'Answers the coach\'s questions about goals and background'),
      ev('Can confirm a profile that is true to them', 'Confirms the drafted profile, or corrects it until it is right'),
    ],
    { coachDirective: 'Draft the learner\'s profile from their answers and ask them to confirm it. Their confirmation counts as evidence for the second objective.' }),
  L12: lesson('L12', 'Foundations 3 - Join the Community', 'Join the program\'s community space.',
    'A screenshot of their first post in the community space, introducing themselves.',
    [
      ev('Can join the community space', 'Shares a screenshot showing they joined'),
      ev('Can introduce themselves to the community', 'Their first post introduces them in their own words'),
    ],
    { coachDirective: 'When the learner is ready to join, share this exact link and code: https://community.example.org/join and the code PLATO-2026. Do not change either.' }),
  L13: lesson('L13', 'Job Placement 3 - LinkedIn Featured Section', 'Set up the Featured section on your LinkedIn profile, step by step.',
    'A screenshot of their LinkedIn Featured section with at least one item added, and a sentence on why they chose it.',
    [
      ev('Can follow the steps to add a Featured item on LinkedIn', 'Shares a screenshot of the Featured section with an item'),
      ev('Can explain why they chose that item', 'Says in one sentence why it represents them'),
    ]),
  L14: lesson('L14', 'AI Leadership 2 - Check Your Understanding', 'A short assessment of the ideas from AI Leadership 1.',
    'Answers to five questions (two multiple choice, two short answer, one worked example) showing they understand how generative AI produces answers.',
    [
      ev('Can answer questions about how generative AI works', 'Answers the multiple-choice and short-answer questions correctly'),
      ev('Can apply the idea to a worked example', 'Works through the example and explains each step'),
    ]),
};

/** The lesson list the Coach is given, as the app writes it. */
export const CATALOG = Object.values(LESSONS).map((l) => `- ${l.name}`).join('\n');

/** A lesson's state before a turn (the lesson KB), as the Lesson Owner would leave it. */
export function lessonKB(lesson, { progress = 0, objectivesMet = [], activitiesCompleted = 0, learnerPosition = 'Working on it', insights = [], status = 'active' } = {}) {
  return { status, progress, objectivesMet, activitiesCompleted, learnerPosition, insights, objectives: lesson.objectives, exemplar: lesson.exemplar };
}
