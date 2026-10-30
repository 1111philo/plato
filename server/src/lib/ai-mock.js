/**
 * Deterministic stand-in for Bedrock, for end-to-end and accessibility tests
 * (e2e/). Enabled with AI_PROVIDER=mock; ai-provider.js refuses it on Lambda.
 *
 * Each agent's prompt starts with an `AGENT: <name>` header (client/prompts),
 * which arrives here inside the system prompt, so the mock answers in the
 * exact shape that agent's parser expects: coach tags, lesson-owner KB JSON,
 * the readiness tag, extractor markdown, and so on.
 *
 * Coach pacing: each learner turn adds 3 progress points; a message containing
 * MOCK_COMPLETE awards 10, so tests can drive a lesson to completion.
 */

const MOCK_USAGE = { input_tokens: 0, output_tokens: 0 };

function agentOf(system) {
  const text = Array.isArray(system) ? system.map((b) => b.text || '').join('\n') : String(system || '');
  return (text.match(/AGENT:\s*([A-Za-z ]+?)\s*\n/) || [])[1] || 'unknown';
}

function textOf(content) {
  if (typeof content === 'string') return content;
  return (content || []).map((p) => (p.type === 'text' ? p.text : '')).join('\n');
}

function lastUserJson(messages) {
  const last = [...(messages || [])].reverse().find((m) => m.role === 'user');
  try { return JSON.parse(textOf(last?.content)); } catch { return {}; }
}

function coachReply(messages) {
  // lessonEngine sends [context, 'Ready.' (assistant), ...history, new turn];
  // the lesson opens with a 'Start the lesson.' cue. Neither is a learner turn.
  const learnerTurns = (messages || []).filter((m) => m.role === 'user').slice(1)
    .filter((m) => textOf(m.content).trim() !== 'Start the lesson.');
  const lastText = textOf([...(messages || [])].reverse().find((m) => m.role === 'user')?.content);
  const done = /MOCK_COMPLETE/.test(lastText);
  const progress = done ? 10 : Math.min(9, learnerTurns.length * 3);
  const body = learnerTurns.length === 0
    ? 'Welcome! In this lesson you will practice the key idea. To start, tell me about a time you used it.'
    : done
      ? 'Excellent work. You have met every objective for this lesson.'
      : 'Good thinking. Can you give a specific example from your own experience?';
  const kb = { insights: [`Mock insight after turn ${learnerTurns.length}`], learnerPosition: `Mock position at progress ${progress}` };
  return `${body}\n\n[PROGRESS: ${progress}]\n[KB_UPDATE: ${JSON.stringify(kb)}]`;
}

function lessonOwnerReply(messages) {
  const input = lastUserJson(messages);
  const objectives = (input.learningObjectives?.length ? input.learningObjectives : ['Can do the first thing', 'Can do the second thing'])
    .map((objective) => ({ objective, evidence: 'Learner writes a short example' }));
  return JSON.stringify({
    exemplar: input.exemplar || 'A short written example.',
    objectives,
    learnerPosition: 'New learner, no activities completed yet.',
    insights: [],
    activitiesCompleted: 0,
    status: 'active',
  });
}

function profileReply(messages) {
  const input = lastUserJson(messages);
  const current = input.currentProfile || {};
  return JSON.stringify({
    profile: { name: current.name || '', goal: current.goal || '', strengths: current.strengths || [], weaknesses: current.weaknesses || [], preferences: current.preferences || {} },
    summary: 'Mock learner profile summary.',
  });
}

const LESSON_MD = `# Mock Lesson

A mock lesson for tests.

## Exemplar

A short written example.

## Learning Objectives

- Can name the key idea
- Can apply it to an example`;

function replyFor(agent, messages) {
  switch (agent) {
    case 'Coach': return coachReply(messages);
    case 'Lesson Owner': return lessonOwnerReply(messages);
    case 'Learner Profile Owner':
    case 'Learner Profile Update': return profileReply(messages);
    case 'Course Progress Updater': return JSON.stringify({ summary: 'Mock course progress note.' });
    case 'Lesson Creator': return 'What should learners be able to do by the end of this lesson?\n\n[READINESS: 3]';
    case 'Knowledge Base Editor': return 'What is your program called, and who is it for?\n\n[READINESS: 2]';
    case 'Lesson Extractor': return LESSON_MD;
    case 'Knowledge Base Extractor': return '# Program\n\nA mock program knowledge base.';
    default: return 'Mock response.';
  }
}

const mockAi = {
  async invoke(_model, body) {
    const text = replyFor(agentOf(body.system), body.messages);
    return { content: [{ type: 'text', text }], usage: MOCK_USAGE, stop_reason: 'end_turn' };
  },

  // Same Anthropic-shaped events converse.js produces, in small chunks with a
  // short delay so the streaming UI (useStreamedText, aria-hidden while
  // streaming) is exercised. A learner message containing MOCK_SLOW streams
  // over about two seconds, for tests of composing during a reply.
  async *invokeStream(_model, body) {
    const text = replyFor(agentOf(body.system), body.messages);
    const lastUser = textOf([...(body.messages || [])].reverse().find((m) => m.role === 'user')?.content);
    const delay = /MOCK_SLOW/.test(lastUser) ? 250 : 5;
    yield { type: 'message_start', message: { role: 'assistant' } };
    for (let i = 0; i < text.length; i += 24) {
      await new Promise((r) => setTimeout(r, delay));
      yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: text.slice(i, i + 24) } };
    }
    yield { type: 'message_stop' };
  },
};

export default mockAi;
export { agentOf, replyFor };
