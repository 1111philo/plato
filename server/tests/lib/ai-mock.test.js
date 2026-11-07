/**
 * The e2e mock provider (src/lib/ai-mock.js) must answer each agent in the
 * exact shape that agent's parser expects. Otherwise the e2e and
 * accessibility suites would test broken UI states instead of real ones.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import mockAi, { agentOf, replyFor } from '../../src/lib/ai-mock.js';

const prompt = (name) => readFileSync(new URL(`../../../client/prompts/${name}.md`, import.meta.url), 'utf8');

describe('ai-mock', () => {
  it('identifies every agent from its real prompt header', () => {
    const expected = {
      coach: 'Coach', 'lesson-owner': 'Lesson Owner', 'lesson-creator': 'Lesson Creator', 'lesson-extractor': 'Lesson Extractor',
      'knowledge-base-editor': 'Knowledge Base Editor', 'knowledge-base-extractor': 'Knowledge Base Extractor',
      'learner-profile-owner': 'Learner Profile Owner', 'learner-profile-update': 'Learner Profile Update',
      'course-progress-update': 'Course Progress Updater',
    };
    for (const [file, agent] of Object.entries(expected)) assert.equal(agentOf(prompt(file)), agent, file);
  });

  it('coach replies carry parseable tags and advance progress, completing on MOCK_COMPLETE', () => {
    // The exact shapes lessonEngine sends (startLesson / sendMessage).
    const ctx = [{ role: 'user', content: '{"lesson":{}}' }, { role: 'assistant', content: 'Ready.' }];
    const turn = (...texts) => [...ctx, ...texts.flatMap((t) => [{ role: 'assistant', content: 'coach' }, { role: 'user', content: t }])];
    const open = replyFor('Coach', [...ctx, { role: 'user', content: 'Start the lesson.' }]);
    assert.match(open, /\[PROGRESS: 0\]/);
    assert.match(open, /^Welcome/);
    const mid = replyFor('Coach', turn('one', 'two'));
    assert.match(mid, /\[PROGRESS: 6\]/);
    const kb = JSON.parse(mid.match(/\[KB_UPDATE: (\{.*\})\]/)[1]);
    assert.ok(Array.isArray(kb.insights) && typeof kb.learnerPosition === 'string');
    assert.match(replyFor('Coach', turn('MOCK_COMPLETE')), /\[PROGRESS: 10\]/);
  });

  it('lesson owner returns a KB that keeps the lesson objectives', () => {
    const kb = JSON.parse(replyFor('Lesson Owner', [{ role: 'user', content: JSON.stringify({ learningObjectives: ['Can A', 'Can B'], exemplar: 'E' }) }]));
    assert.deepEqual(kb.objectives.map((o) => o.objective), ['Can A', 'Can B']);
    assert.equal(kb.status, 'active');
    assert.equal(kb.activitiesCompleted, 0);
  });

  it('creator and KB editor end with a readiness tag; extractor emits valid lesson markdown', () => {
    assert.match(replyFor('Lesson Creator', []), /\[READINESS: \d+\]$/);
    assert.match(replyFor('Knowledge Base Editor', []), /\[READINESS: \d+\]$/);
    const md = replyFor('Lesson Extractor', []);
    assert.match(md, /^## Learning Objectives$/m);
    assert.equal((md.match(/^- Can /gm) || []).length, 2);
  });

  it('streams Anthropic-shaped text deltas that reassemble to the full reply', async () => {
    let text = '';
    const msgs = [{ role: 'user', content: '{}' }, { role: 'assistant', content: 'Ready.' }, { role: 'user', content: 'Start the lesson.' }];
    for await (const e of mockAi.invokeStream('x', { system: prompt('coach'), messages: msgs })) {
      if (e.type === 'content_block_delta') text += e.delta.text;
    }
    assert.equal(text, replyFor('Coach', msgs));
  });
});
