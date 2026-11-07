/**
 * The server parses each lesson for `GET /v1/lessons` (server/src/lib/
 * lesson-parse.js) instead of sending its markdown (#451 scale review, B1).
 * It must read lessons exactly as the client's parseLessonPrompt does: same
 * inputs, same output, including every lesson bundled with plato.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

globalThis.localStorage = { _s: {}, getItem(k) { return this._s[k] ?? null; }, setItem(k, v) { this._s[k] = v; }, removeItem(k) { delete this._s[k]; } };
globalThis.fetch = async () => ({ ok: false, status: 404 });

const { parseLessonPrompt } = await import('../js/lessonOwner.js');
const { parseLessonFields } = await import('../../server/src/lib/lesson-parse.js');

const lessonsDir = new URL('../prompts/lessons/', import.meta.url);
const samples = [
  ...readdirSync(lessonsDir).filter((f) => f.endsWith('.md')).map((f) => readFileSync(new URL(f, lessonsDir), 'utf8')),
  '# Only a title',
  '',
  '# Name\n\nFirst para.\nSecond line ignored.\n\n## exemplar\n\nLower-case heading.\n\n## Learning   Objectives\n\n-   Can spaced\n* not a dash\n- Can two',
  '# A\n## Exemplar\nline1\n\nline2\n## Coach Directive\n\n  keep   spacing  \n## Other\nx',
  '# A\r\n\r\nWindows line endings.\r\n\r\n## Learning Objectives\r\n\r\n- Can one\r\n',
  'no heading\n\n## Learning Objectives\n- Can x',
];

describe('server lesson parsing matches the client', () => {
  for (const [i, md] of samples.entries()) {
    it(`sample ${i}`, () => {
      const { lessonId: _id, ...client } = parseLessonPrompt('x', md);
      assert.deepEqual(parseLessonFields(md), client);
    });
  }
});

describe('loadLessons uses the parsed fields', () => {
  it('builds the same lesson from `parsed` as from `markdown`', async () => {
    const md = samples[0];
    const { loadLessons, invalidateLessonsCache } = await import('../js/lessonOwner.js');
    const serve = (lesson) => {
      globalThis.fetch = async (url) => (String(url).includes('/v1/lessons')
        ? { ok: true, status: 200, json: async () => [lesson] }
        : { ok: false, status: 404, json: async () => ({}) });
    };
    localStorage.setItem('plato_auth', JSON.stringify({ accessToken: 't', refreshToken: 'r' }));
    serve({ lessonId: 'getting-started', parsed: parseLessonFields(md) });
    invalidateLessonsCache();
    const [fromParsed] = await loadLessons();
    serve({ lessonId: 'getting-started', markdown: md });
    invalidateLessonsCache();
    const [fromMarkdown] = await loadLessons();
    assert.deepEqual(fromParsed, fromMarkdown);
    assert.ok(fromParsed.learningObjectives.length >= 2);
  });
});
