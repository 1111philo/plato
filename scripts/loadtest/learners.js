// k6: learners' read/write paths (no AI). Each VU is one test account that
// signs in once, loads the classroom like the SPA does, then every 60–90 s
// saves a coach turn (PUT lessonKB:<id> and messages:<id>, with the version
// the server returned last), refocuses the tab now and then (GET /v1/sync,
// /v1/me, /v1/me/messages), and refreshes its token once mid-test.
//
//   k6 run -e BASE=https://playground.ai-leaders.org scripts/loadtest/learners.js
//
// Env: BASE (required, never prod), VUS (default 900), RAMP (default 2m:
// the sign-in burst), HOLD (default 6m), USERS (default .out/users.json).
// Aborts if more than 5% of requests fail.
import http from 'k6/http';
import { check, sleep } from 'k6';
import exec from 'k6/execution';
import { Counter } from 'k6/metrics';

const BASE = __ENV.BASE;
if (!BASE || /plato\.courses|learn\.ai-leaders\.org/.test(BASE)) throw new Error('Set BASE to a non-prod URL (e.g. https://playground.ai-leaders.org)');
const creds = JSON.parse(open(__ENV.USERS || './.out/users.json'));
const VUS = Number(__ENV.VUS || 900);
if (VUS > creds.users.length) throw new Error(`only ${creds.users.length} accounts for ${VUS} VUs`);

const status = new Counter('status_by_endpoint');

export const options = {
  scenarios: {
    learners: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: __ENV.RAMP || '2m', target: VUS },
        { duration: __ENV.HOLD || '6m', target: VUS },
        { duration: '20s', target: 0 },
      ],
      gracefulRampDown: '95s',
    },
  },
  thresholds: {
    http_req_failed: [{ threshold: 'rate<0.05', abortOnFail: true, delayAbortEval: '60s' }],
  },
  summaryTrendStats: ['p(50)', 'p(95)', 'p(99)', 'max', 'count'],
  discardResponseBodies: false,
};

// Per-VU state (each VU has its own JS runtime).
let session = null; // { access, refresh, at, refreshed }
let versions = {};
let messages = [];
let turn = 0;
const LESSON = __ENV.LESSON || 'getting-started';

function req(method, path, body, name, auth = true) {
  const headers = { 'content-type': 'application/json' };
  if (auth) headers.authorization = `Bearer ${session.access}`;
  const res = http.request(method, `${BASE}${path}`, body === undefined ? null : JSON.stringify(body), { headers, tags: { name } });
  status.add(1, { name, status: String(res.status) });
  if (res.status === 401 && auth && session?.refresh) {
    refresh('401');
    return http.request(method, `${BASE}${path}`, body === undefined ? null : JSON.stringify(body), { headers: { ...headers, authorization: `Bearer ${session.access}` }, tags: { name } });
  }
  return res;
}

function login() {
  const email = creds.users[exec.vu.idInTest - 1];
  const res = http.post(`${BASE}/v1/auth/login`, JSON.stringify({ email, password: creds.password }), { headers: { 'content-type': 'application/json' }, tags: { name: 'POST /v1/auth/login' } });
  status.add(1, { name: 'POST /v1/auth/login', status: String(res.status) });
  if (!check(res, { 'login 200': (r) => r.status === 200 })) return false;
  const j = res.json();
  session = { access: j.accessToken, refresh: j.refreshToken, at: Date.now(), refreshed: false };
  return true;
}

function refresh(why) {
  const res = http.post(`${BASE}/v1/auth/refresh`, JSON.stringify({ refreshToken: session.refresh }), { headers: { 'content-type': 'application/json' }, tags: { name: 'POST /v1/auth/refresh', why } });
  status.add(1, { name: 'POST /v1/auth/refresh', status: String(res.status) });
  if (check(res, { 'refresh 200': (r) => r.status === 200 })) {
    const j = res.json();
    session = { ...session, access: j.accessToken, refresh: j.refreshToken, at: Date.now(), refreshed: true };
  }
}

// What the SPA fetches on load (client/js + client/src).
function boot() {
  const pub = [
    ['GET', '/v1/auth/setup-status'], ['GET', '/v1/version'], ['GET', '/v1/branding'],
  ];
  for (const [m, p] of pub) req(m, p, undefined, `${m} ${p}`, false);
  for (const p of ['/v1/me', '/v1/me/fields', '/v1/plugins', '/v1/sync', '/v1/lessons', '/v1/lessons/time-stats',
    '/v1/me/messages', '/v1/me/invite', '/v1/knowledge-base', '/v1/prompts/coach']) {
    req('GET', p, undefined, `GET ${p}`);
  }
  const kb = req('GET', `/v1/sync/lessonKB:${LESSON}`, undefined, 'GET /v1/sync/:key');
  if (kb.status === 200) versions[`lessonKB:${LESSON}`] = kb.json().version || 0;
  const msgs = req('GET', `/v1/sync/messages:${LESSON}`, undefined, 'GET /v1/sync/:key');
  if (msgs.status === 200) { versions[`messages:${LESSON}`] = msgs.json().version || 0; messages = msgs.json().data || []; }
}

function put(key, data) {
  let res = req('PUT', `/v1/sync/${key}`, { data, version: versions[key] || 0 }, 'PUT /v1/sync/:key');
  if (res.status === 409) { // the client's own recovery (storage.js)
    const cur = req('GET', `/v1/sync/${key}`, undefined, 'GET /v1/sync/:key');
    versions[key] = cur.json().version;
    res = req('PUT', `/v1/sync/${key}`, { data, version: versions[key] }, 'PUT /v1/sync/:key');
  }
  if (res.status === 200) versions[key] = res.json().version;
}

const COACH = 'That is a solid start. You named the audience and the outcome, which is exactly what the first objective asks for. '.repeat(8);

function saveTurn() {
  turn += 1;
  const now = Date.now();
  messages.push({ role: 'user', content: `Load test learner message ${turn}: here is my attempt at the activity, with a few sentences of detail.`, msgType: 'user', phase: 'learning', metadata: null, timestamp: now });
  messages.push({ role: 'assistant', content: COACH, msgType: 'guide', phase: 'learning', metadata: { agents: [{ id: 'coach', read: ['lesson', 'profile', 'conversation'], did: 'replied' }] }, timestamp: now + 1 });
  put(`lessonKB:${LESSON}`, {
    lessonId: LESSON, status: 'active', progress: Math.min(9, turn), activitiesCompleted: turn,
    objectives: [{ objective: 'Can name the audience' }, { objective: 'Can state the outcome' }, { objective: 'Can draft a first version' }],
    objectivesMet: turn > 2 ? [0] : [], insights: [`Load test insight ${turn}`], learnerPosition: 'Working through the activity',
    startedAt: now - turn * 75000, updatedAt: now,
  });
  put(`messages:${LESSON}`, messages);
}

export default function () {
  if (!session) {
    if (!login()) { sleep(5); return; }
    boot();
    sleep(Math.random() * 60); // learners don't all type at once
    return;
  }
  // Refresh once, at a random point 3–6 min in (the real one is at 15 min).
  if (!session.refreshed && Date.now() - session.at > (180 + Math.random() * 180) * 1000) refresh('scheduled');
  saveTurn();
  if (turn % 3 === 0) { // tab refocus
    req('GET', '/v1/sync', undefined, 'GET /v1/sync');
    req('GET', '/v1/me', undefined, 'GET /v1/me');
    req('GET', '/v1/me/messages', undefined, 'GET /v1/me/messages');
  }
  sleep(60 + Math.random() * 30);
}
