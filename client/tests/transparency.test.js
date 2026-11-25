/**
 * Coverage checks for Trace mode (#595): these fail when the code gains
 * something that shapes a conversation and plato's description of itself
 * (src/lib/transparency.js) doesn't know about it. They read source files, as
 * focus-styles.test.js does.
 *
 * An AI call that bypasses the recorder, an undescribed agent, context field,
 * recorded step, rule, constant, event, or outside service: each is a gap in
 * the Trace, and each fails here.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.fetch = async () => ({ ok: false, status: 404 });

const CLIENT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = join(CLIENT, '..');
const read = (...p) => readFileSync(join(REPO, ...p), 'utf8');
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(js|jsx|mjs)$/.test(name) && !/\.test\./.test(name)) out.push(full);
  }
  return out;
}
const files = (...dirs) => dirs.flatMap((d) => walk(join(REPO, d))).map((f) => ({ path: relative(REPO, f), text: readFileSync(f, 'utf8') }));

const { AGENTS, STEPS, RULES, THRESHOLDS, EVENTS, SERVICES, CONTEXT_FIELDS, PROMPT_PARTS, SOURCES } = await import('../src/lib/transparency.js');
const { buildContext } = await import('../src/lib/lessonEngine.js');
const { systemPromptParts } = await import('../js/promptAssembly.js');
const { LLM } = await import('../js/api.js');

const CLIENT_CODE = files('client/js', 'client/src');

describe('every AI call goes through the recorder', () => {
  it('the browser calls the AI only from orchestrator.js', () => {
    const callers = CLIENT_CODE.filter((f) => f.text.includes('/v1/ai/messages')).map((f) => f.path);
    assert.deepEqual(callers, ['client/js/orchestrator.js']);
  });

  it('every call in orchestrator.js names its agent and passes the recorder on', () => {
    const src = read('client/js/orchestrator.js');
    const calls = src.split('await callApi({').slice(1).map((s) => s.slice(0, s.indexOf('});')));
    assert.ok(calls.length >= 9);
    for (const c of calls) {
      assert.match(c, /agent: '[a-z-]+'/, `a callApi call has no agent:\n${c}`);
      assert.match(c, /\btrace\b/, `a callApi call doesn't pass trace:\n${c}`);
      assert.match(c, /parts[:,]/, `a callApi call builds its prompt outside agentParts:\n${c}`);
      assert.ok(AGENTS[c.match(/agent: '([a-z-]+)'/)[1]]);
    }
    // The two request bodies ask for server facts only when tracing.
    assert.equal(src.split("...(trace ? { trace: true } : {})").length - 1, 2);
    assert.equal(src.split("Fetch('/v1/ai/messages'").length - 1, 2);
  });

  it('plugins’ browser code doesn’t call the AI', () => {
    assert.deepEqual(files('plugins').filter((f) => /\/client\//.test(f.path) && f.text.includes('/v1/ai/messages')).map((f) => f.path), []);
  });
});

describe('plugins that act when a lesson starts', () => {
  // A plugin's `lessonStarted` handler runs on the server, where the browser's
  // recorder can't see it. The host gives a traced call a recorder
  // (`ctx.trace`) and records `ctx.ai` calls itself (server/src/lib/plugins/
  // trace.js). A plugin that hooks lesson start without using them leaves a
  // hole in the Trace, and fails here.
  const hooked = readdirSync(join(REPO, 'plugins')).filter((id) => {
    try { return (JSON.parse(read('plugins', id, 'plugin.json')).extensionPoints?.hooks || []).includes('lessonStarted'); } catch { return false; }
  });
  const serverCode = (id) => files(`plugins/${id}`).filter((f) => !/\/client\//.test(f.path));

  it('the scan finds the plugins that hook lesson start', () => {
    assert.ok(hooked.includes('wordpress-info'));
  });

  it('each one reports what it did to the recorder', () => {
    for (const id of hooked) {
      const code = serverCode(id);
      const all = code.map((f) => f.text).join('\n');
      assert.match(all, /\bctx\.trace\b/, `plugins/${id} hooks lessonStarted but never uses ctx.trace, so its work is missing from the Trace`);
      assert.match(all, /\btrace\??\.(note|record|fetch)\(/, `plugins/${id} never records a step`);
    }
  });

  it('each one’s AI calls go through ctx.ai, which the host records', () => {
    for (const id of hooked) {
      for (const f of serverCode(id)) {
        assert.doesNotMatch(f.text, /ai-provider|@aws-sdk\/client-bedrock|bedrock\.js/, `${f.path} calls the AI outside ctx.ai, so the call isn't recorded`);
      }
    }
  });

  it('each one’s outbound requests go through the recorder', () => {
    for (const id of hooked) {
      for (const f of serverCode(id)) {
        // Every bare `fetch(` must sit beside a `trace.fetch(` on the same
        // line (the traced/untraced choice), or be recorded by hand.
        const bare = f.text.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l) && /(?<![.\w])fetch\(/.test(l));
        for (const line of bare) {
          assert.ok(/\btrace\.fetch\(/.test(line) || /\btrace\??\.record\(\{\s*type: 'fetch'/.test(f.text), `${f.path} sends a request the Trace won't show:\n${line.trim()}`);
        }
      }
    }
  });

  it('the host asks for and returns plugin steps only when tracing', () => {
    assert.equal(read('client/src/lib/lessonEngine.js').split("...(trace ? { trace: true } : {})").length - 1, 1);
    const route = read('server/src/routes/sync.js');
    assert.match(route, /const tracing = trace === true;/);
    assert.match(route, /\.\.\.\(tracing \? \{ trace: true \} : \{\}\)/);
    assert.match(route, /if \(!collector\) return c\.json\(\{ enrichments, startupSteps \}\);/);
  });
});

describe('agents', () => {
  it('the registry has exactly the prompt files', () => {
    const prompts = readdirSync(join(CLIENT, 'prompts')).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)).sort();
    assert.deepEqual(Object.keys(AGENTS).sort(), prompts);
  });

  it('each agent is fully described', () => {
    for (const [id, a] of Object.entries(AGENTS)) {
      for (const k of ['label', 'purpose', 'when']) assert.ok(a[k], `${id}.${k}`);
      assert.ok(a.reads.length && a.writes.length, id);
    }
  });

  it('the model named here is the one the app uses', () => {
    assert.match(read('server/src/lib/ai-provider.js'), new RegExp(`export const LLM = '${LLM}'`));
    assert.ok(LLM.startsWith('qwen3-vl') && /Qwen3-VL/.test(SERVICES.model.name));
  });
});

describe('the coach’s context', () => {
  const lesson = { name: 'L', description: 'D', exemplar: 'E', coachDirective: 'Be kind', unit: { name: 'U' }, course: { id: 'c', name: 'U' }, program: { name: 'P' } };
  const kb = (extra) => ({ objectives: [{ objective: 'Can a', evidence: 'e' }], objectivesMet: [0], insights: ['i'], learnerPosition: 'p', progress: 3, enrichments: [{ label: 'x', context: 'c', reasoning: 'r' }], ...extra });

  it('every field it can contain is described', () => {
    const seen = new Set();
    for (const extra of [{ activitiesCompleted: 1 }, { activitiesCompleted: 9 }, { activitiesCompleted: 12 }, { activitiesCompleted: 16 }, { activitiesCompleted: 21 }, { status: 'completed' }]) {
      for (const k of Object.keys(JSON.parse(buildContext(lesson, kb(extra), 'summary', 'Ada', 'unit note')))) seen.add(k);
    }
    assert.deepEqual([...seen].sort(), Object.keys(CONTEXT_FIELDS).sort());
  });

  it('every part of a system prompt is described', () => {
    const kinds = systemPromptParts({ prompt: 'a<!-- AFTER CONTEXT -->b', kb: 'k', catalog: 'c', addendum: 'x', languageDirective: 'l' }).map((p) => p.kind);
    assert.deepEqual(kinds.sort(), Object.keys(PROMPT_PARTS).sort());
  });
});

describe('recorded steps and rules', () => {
  it('every step the code records is described, and nothing described is unused', () => {
    const used = new Set();
    for (const f of CLIENT_CODE) {
      for (const m of f.text.matchAll(/(?:\btrace\??\.step|\bnote|\bstep)\('([A-Za-z]+)'/g)) used.add(m[1]);
    }
    used.delete('initializing'); // lesson-start progress callback, not a trace step
    assert.deepEqual([...used].sort(), Object.keys(STEPS).sort());
    for (const s of Object.values(STEPS)) assert.ok(s.title && s.means && SOURCES[s.source]);
  });

  it('every rule the code can report is described, and nothing described is unused', () => {
    const src = read('client/src/lib/lessonTrace.js') + read('client/src/lib/lessonEngine.js');
    const used = new Set([...src.matchAll(/rules\.push\('([A-Za-z0-9]+)'\)/g)].map((m) => m[1]));
    for (const m of src.matchAll(/\? \['([A-Za-z0-9]+)'\] : \[\]/g)) used.add(m[1]);
    assert.deepEqual([...used].sort(), Object.keys(RULES).sort());
  });

  it('every scoring or pacing number is described, and the server’s copy matches', async () => {
    const constants = await import('../src/lib/constants.js');
    const assessment = await import('../src/lib/assessment.js');
    for (const [name, value] of [...Object.entries(constants), ...Object.entries(assessment)]) {
      if (typeof value === 'number') assert.ok(THRESHOLDS[name], `${name} isn't described in THRESHOLDS`);
    }
    for (const [name, t] of Object.entries(THRESHOLDS)) assert.match(read(t.where), new RegExp(`\\b${name}\\b`), `${name} isn't in ${t.where}`);
    const server = read('server/src/lib/lesson-limits.js');
    for (const name of ['MAX_EXCHANGES', 'MIN_OBJECTIVES', 'MAX_OBJECTIVES', 'MINS_PER_EXCHANGE']) {
      assert.match(server, new RegExp(`export const ${name} = ${constants[name]};`), `${name} differs between client and server`);
    }
  });
});

describe('events reported to the server’s logs', () => {
  it('the codes the app sends, the codes the server accepts, and the described codes are the same', () => {
    const sent = new Set();
    for (const f of CLIENT_CODE) {
      for (const line of f.text.split('\n').filter((l) => /\breport(?:Event)?\(/.test(l))) {
        for (const m of line.matchAll(/'((?:coach|conversation)_[a-z_]+)'/g)) sent.add(m[1]);
      }
    }
    const accepted = [...read('server/src/routes/ai.js').match(/const CLIENT_EVENTS = new Set\(\[([\s\S]*?)\]\)/)[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    assert.deepEqual([...sent].sort(), Object.keys(EVENTS).sort());
    assert.deepEqual(accepted.sort(), Object.keys(EVENTS).sort());
  });
});

describe('outside services', () => {
  // Each AWS SDK client and outbound host the server or a plugin uses, and
  // the described service it belongs to. A new one must be added to both.
  const AWS = { 'client-bedrock-runtime': 'bedrock', 'client-dynamodb': 'dynamodb', 'lib-dynamodb': 'dynamodb', 'client-ses': 'ses', 'client-sesv2': 'ses', 'client-cloudwatch-logs': 'logs', 'client-lambda': 'lambda' };
  const HOSTS = { 'slack.com': 'slack', 'login.microsoftonline.com': 'sso', 'developer.wordpress.org': 'wordpress', 'make.wordpress.org': 'wordpress', 'api.github.com': 'wordpress' };
  const SERVER_CODE = files('server/src', 'plugins').filter((f) => !/\/client\//.test(f.path));

  it('every AWS client the server uses belongs to a described service', () => {
    const used = new Set();
    for (const f of SERVER_CODE) for (const m of f.text.matchAll(/from '@aws-sdk\/([a-z0-9-]+)'/g)) used.add(m[1]);
    for (const pkg of used) assert.ok(SERVICES[AWS[pkg]], `@aws-sdk/${pkg} isn't mapped to a described service`);
  });

  it('every outside host the server or a plugin calls belongs to a described service', () => {
    const IGNORE = /example\.|localhost|w3\.org|schemas?\.|github\.com\/1111philo|plato\.courses|ai-leaders\.org|aws\.amazon\.com|amazonaws\.com|docs\.|api\.slack\.com|react\.dev|json-schema\.org|mozilla\.org|ietf\.org|wikipedia\.org|microsoft\.com\/|owasp\.org/;
    const hosts = new Set();
    for (const f of SERVER_CODE) {
      // Code lines only (not comments), and not links to docs or plato itself.
      for (const line of f.text.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l) && !IGNORE.test(l))) {
        for (const m of line.matchAll(/https:\/\/([a-z0-9.-]+\.[a-z]{2,})/g)) hosts.add(m[1]);
      }
    }
    assert.ok(hosts.has('developer.wordpress.org') && hosts.size >= 2, 'the scan finds the hosts plugins call');
    for (const h of hosts) assert.ok(SERVICES[HOSTS[h]], `${h} isn't mapped to a described service`);
  });

  it('every host a plugin allows itself to call belongs to a described service', async () => {
    // Plugins that guard their requests with an allowlist (SSRF defense)
    // export it; a host added there must be described here too.
    const lists = SERVER_CODE.filter((f) => /^plugins\//.test(f.path) && /export const ALLOWED_HOSTS\b/.test(f.text));
    assert.ok(lists.some((f) => f.path === 'plugins/wordpress-info/server/sources.js'));
    for (const f of lists) {
      const { ALLOWED_HOSTS } = await import(join(REPO, f.path));
      for (const h of ALLOWED_HOSTS) assert.ok(SERVICES[HOSTS[h]], `${h} (${f.path}) isn't mapped to a described service`);
    }
  });

  it('the browser only talks to plato’s own server', () => {
    const absolute = CLIENT_CODE.filter((f) => /fetch\(\s*['"`]https?:/.test(f.text)).map((f) => f.path);
    assert.deepEqual(absolute, []);
    assert.doesNotMatch(read('client/index.html'), /(?:src|href)="https?:\/\//);
  });

  it('each service says what it is sent', () => {
    for (const [id, s] of Object.entries(SERVICES)) for (const k of ['name', 'role', 'when', 'sent']) assert.ok(s[k], `${id}.${k}`);
  });
});

describe('sync records', () => {
  it('every kind of record the browser writes is accepted by the server', () => {
    const valid = new RegExp(read('server/src/routes/sync.js').match(/const VALID_DATA_KEYS = \/(.+)\/;/)[1]);
    const storage = read('client/js/storage.js');
    const prefixes = new Set([...storage.matchAll(/[`'"]([A-Za-z]+):\$\{/g)].map((m) => m[1]));
    assert.ok(prefixes.has('trace') && prefixes.has('messages'));
    for (const p of prefixes) assert.ok(valid.test(p === 'trace' ? 'trace:lesson-1:t:1' : `${p}:x`), `${p}:* isn't an accepted sync key`);
  });
});
