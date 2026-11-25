/**
 * A simulated learner (docs/AGENT_EVALS.md section 4, "Whole lessons"): a
 * second call to the same model, playing a character card. It sees the
 * lesson as a learner does (its name and description, the Coach's messages)
 * and nothing about what plato checks.
 *
 * A learner who would send a screenshot writes [SCREENSHOT]; the harness
 * attaches the lesson's fixture image in its place (fixtures/images.js).
 */
import { CARDS, STAGES } from '../fixtures/learners.js';

export const SCREENSHOT = /\[SCREENSHOT\]/i;

export function learnerSystem({ card, stage, lesson, canScreenshot }) {
  const c = CARDS[card];
  return [
    'You are role-playing a learner in a short online lesson with an AI coach. Stay in character the whole time.',
    `Who you are: ${c.who}`,
    stage ? `Where you are in life: ${STAGES[stage]}` : '',
    `Your name is Sam. The lesson is "${lesson.name}": ${lesson.description}`,
    c.language ? `Write only in ${c.language}.` : '',
    'Reply as this learner, one chat message at a time, the way they would type it. Usually 1 to 4 sentences, or less if your character is brief. Only write work in the chat if your character would.',
    'You can only send text in this chat, and screenshots. You cannot send files, audio or video.',
    canScreenshot
      ? 'When the coach asks for a screenshot of something you have made (and your character would make it), put [SCREENSHOT] on its own line in your message: the screenshot is attached for you. Say what you would say about it alongside.'
      : 'This lesson needs no screenshots.',
    'Never say you are an AI or that this is a role-play. If the coach says the lesson is complete, reply with a short thanks.',
  ].filter(Boolean).join('\n\n');
}

/**
 * The learner's next message. `history` is the conversation from plato's
 * side ([{ role, content }], the learner as 'user'); the learner sees it the
 * other way round.
 */
export async function learnerReply({ model, card, stage, lesson, canScreenshot, history }) {
  const flipped = history.map((m) => ({ role: m.role === 'user' ? 'assistant' : 'user', content: typeof m.content === 'string' ? m.content : (m.content.find((p) => p.type === 'text')?.text || '[screenshot]') }));
  const text = await model.call({ system: learnerSystem({ card, stage, lesson, canScreenshot }), messages: flipped, maxTokens: 600, temperature: 0.8 });
  const screenshot = canScreenshot && SCREENSHOT.test(text);
  return { text: text.replace(SCREENSHOT, '').trim(), screenshot };
}
