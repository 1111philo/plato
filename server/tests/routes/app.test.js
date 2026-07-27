import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import app from '../../src/routes/app.js';

function makeApp() {
  const server = new Hono();
  server.route('/', app);
  return server;
}

describe('marketing redirects', () => {
  const cases = [
    ['/employers', 'https://ai-leaders.org/employers'],
    ['/edu-partners', 'https://ai-leaders.org/edu-partners'],
  ];

  for (const [path, target] of cases) {
    it(`redirects ${path} to the marketing site`, async () => {
      const res = await makeApp().request(path);
      assert.equal(res.status, 302);
      assert.equal(res.headers.get('location'), target);
    });
  }

  // A 301 would be cached indefinitely by learners' browsers, making the
  // mapping practically irreversible.
  it('uses a temporary redirect so the mapping stays changeable', async () => {
    const res = await makeApp().request('/employers');
    assert.notEqual(res.status, 301);
  });

  it('does not redirect unrelated app routes', async () => {
    const res = await makeApp().request('/plato/lessons');
    assert.equal(res.status === 302, false);
  });

  it('leaves API routes to their own handlers', async () => {
    const res = await makeApp().request('/v1/employers');
    assert.equal(res.status, 404);
  });
});
