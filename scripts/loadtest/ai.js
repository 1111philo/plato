// k6: real coach streams against real Bedrock, through the same endpoint and
// body shape the client uses (POST /v1/ai/messages, stream: true, the coach
// prompt + program knowledge base + lesson catalog as the system prompt, the
// context message, a short conversation tail, max_tokens 2048).
//
//   k6 run -e BASE=https://playground.ai-leaders.org scripts/loadtest/ai.js
//
// Two steps, each a burst of simultaneous streams, one account per VU (so the
// per-user AI limits never apply): STEP1 VUs × ITER1 streams (default 50 × 3),
// then STEP2 × ITER2 (default 100 × 2) starting at STEP2_AT (default 2m30s).
// Default total: 350 Bedrock calls. VUs go back to back (no think time), so
// concurrency stays near the step size.
//
// http_req_waiting is time to first token: the server holds the response
// headers until Bedrock's first event (server/src/routes/ai.js).
import http from 'k6/http';
import { check } from 'k6';
import exec from 'k6/execution';
import { Counter, Trend } from 'k6/metrics';

const BASE = __ENV.BASE;
if (!BASE || /plato\.courses|learn\.ai-leaders\.org/.test(BASE)) throw new Error('Set BASE to a non-prod URL');
const creds = JSON.parse(open(__ENV.USERS || './.out/users.json'));
const OFFSET = Number(__ENV.OFFSET || 0); // skip accounts used by another run

const ttft = new Trend('coach_ttft', true);
const total = new Trend('coach_total', true);
const tokens = new Trend('coach_output_tokens');
const outcome = new Counter('coach_outcome');

export const options = {
  scenarios: {
    step1: { executor: 'per-vu-iterations', vus: Number(__ENV.STEP1 || 50), iterations: Number(__ENV.ITER1 || 3), maxDuration: '4m' },
    step2: { executor: 'per-vu-iterations', vus: Number(__ENV.STEP2 || 100), iterations: Number(__ENV.ITER2 || 2), startTime: __ENV.STEP2_AT || '2m30s', maxDuration: '4m' },
  },
  thresholds: {
    // Stop early if streams start failing.
    'coach_outcome{result:error}': [{ threshold: 'count<30', abortOnFail: true }],
  },
  summaryTrendStats: ['p(50)', 'p(95)', 'p(99)', 'max', 'count'],
};

const json = { 'content-type': 'application/json' };

export function setup() {
  const login = http.post(`${BASE}/v1/auth/login`, JSON.stringify({ email: creds.users[OFFSET], password: creds.password }), { headers: json });
  const auth = { ...json, authorization: `Bearer ${login.json().accessToken}` };
  const coach = http.get(`${BASE}/v1/prompts/coach`, { headers: auth }).json().content;
  const kb = http.get(`${BASE}/v1/knowledge-base`, { headers: auth }).json().content;
  const lessons = http.get(`${BASE}/v1/lessons`, { headers: auth }).json();
  const catalog = lessons.map((l) => `- ${l.name || l.lessonId}`).join('\n');
  const system = `${coach}\n\n---\n\n## Program Knowledge Base\n\n${kb}\n\n---\n\n## Lessons in This Classroom\n\n${catalog}`;
  const lesson = lessons.find((l) => l.lessonId === 'getting-started') || lessons[0];
  return { system, lesson: { name: lesson.name, description: lesson.parsed?.description || '', exemplar: lesson.parsed?.exemplar || '', objectives: lesson.parsed?.learningObjectives || [] } };
}

let access = null;

function login() {
  // Distinct accounts across both steps: step1 VU n → OFFSET+1+n, step2 likewise after step1's block.
  const idx = OFFSET + 1 + exec.vu.idInTest;
  const res = http.post(`${BASE}/v1/auth/login`, JSON.stringify({ email: creds.users[idx], password: creds.password }), { headers: json, tags: { name: 'POST /v1/auth/login' } });
  if (res.status === 200) access = res.json().accessToken;
}

const LEARNER = [
  'I think the audience for my project is first-year students who have never used an AI tool before.',
  'My goal is that by the end they can write one clear prompt and judge whether the answer is any good.',
  'Here is my first draft of the activity: students pick a topic, ask the AI three questions, and compare the answers with a textbook.',
  'Could you tell me what is weak about that draft, and what I should change first?',
];

export default function (data) {
  if (!access) login();
  if (!access) { outcome.add(1, { result: 'error', why: 'login' }); return; }
  const turn = exec.vu.iterationInScenario;
  const context = JSON.stringify({
    learnerName: 'Load', lessonName: data.lesson.name, lessonDescription: data.lesson.description, exemplar: data.lesson.exemplar,
    lessonStatus: 'active', objectives: data.lesson.objectives.map((o) => ({ objective: o, evidence: [] })), insights: [],
    learnerProfile: 'No profile yet', learnerPosition: 'New learner', progress: turn, activitiesCompleted: turn,
  });
  const messages = [{ role: 'user', content: context }, { role: 'assistant', content: 'Ready.' }];
  for (let i = 0; i < turn; i++) {
    messages.push({ role: 'user', content: LEARNER[i % LEARNER.length] });
    messages.push({ role: 'assistant', content: 'Good start. Tell me more about who the learners are and what you want them to be able to do.' });
  }
  messages.push({ role: 'user', content: LEARNER[turn % LEARNER.length] });

  const res = http.post(`${BASE}/v1/ai/messages`, JSON.stringify({ model: 'qwen3-vl-235b', max_tokens: 2048, system: data.system, messages, stream: true }),
    { headers: { ...json, authorization: `Bearer ${access}` }, tags: { name: 'POST /v1/ai/messages (stream)' }, timeout: '130s' });
  const body = res.body || '';
  const done = body.includes('data: [DONE]');
  const errEvent = body.includes('"type":"error"');
  const ok = res.status === 200 && done && !errEvent;
  check(res, { 'stream completed': () => ok });
  outcome.add(1, { result: ok ? 'ok' : 'error', status: String(res.status), why: ok ? '' : (errEvent ? 'error_event' : !done && res.status === 200 ? 'no_done' : (body.slice(0, 120) || res.error || 'empty')) });
  if (ok) {
    ttft.add(res.timings.waiting);
    total.add(res.timings.duration);
    const m = body.match(/"output_tokens":(\d+)/g);
    if (m) tokens.add(Number(m[m.length - 1].split(':')[1]));
  }
}
