/**
 * POST /v1/ai/events (#451 third review): client-side events the server
 * logs so /v1/admin/logs can count them. Known codes only, signed in only.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import ai from '../../src/routes/ai.js';
import db from '../../src/lib/db.js';
import { signAccessToken } from '../../src/lib/jwt.js';
import { logger } from '../../src/lib/logger.js';

const app = () => { const a = new Hono(); a.route('/', ai); return a; };
async function post(body, auth = true) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) headers.Authorization = 'Bearer ' + await signAccessToken('usr_ada', 'learner');
  return app().request('/v1/ai/events', { method: 'POST', headers, body: JSON.stringify(body) });
}

describe('POST /v1/ai/events', () => {
  let logged;
  beforeEach(() => {
    db.getUserById = async () => ({ userId: 'usr_ada', role: 'learner' });
    logged = [];
    logger.warn = (code, meta) => { logged.push([code, meta]); };
  });

  it('logs a known code with the user and lesson', async () => {
    for (const code of ['coach_tags_recovered', 'coach_tags_unrecovered', 'conversation_too_long']) {
      assert.equal((await post({ code, lessonId: 'les-1' })).status, 200);
    }
    assert.deepEqual(logged.map(([c]) => c), ['coach_tags_recovered', 'coach_tags_unrecovered', 'conversation_too_long']);
    assert.deepEqual(logged[0][1], { userId: 'usr_ada', lessonId: 'les-1' });
  });

  it('refuses unknown codes and anonymous callers', async () => {
    assert.equal((await post({ code: 'unhandled_error' })).status, 400);
    assert.equal((await post({ code: 'coach_tags_recovered' }, false)).status, 401);
    assert.deepEqual(logged, []);
  });
});
