/**
 * Notifications email side (#388, #389, #400, src/lib/notifications.js).
 * Real SQLite for the stored parts; the SES transport is swapped out.
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, unlinkSync } from 'node:fs';

const DB_PATH = './data/test-notifications.db';
process.env.DB_BACKEND = 'sqlite';
process.env.SQLITE_PATH = DB_PATH;
const { default: db } = await import('../../src/lib/db-sqlite.js');
const n = await import('../../src/lib/notifications.js');

const sent = [];
before(() => n.setEmailTransport(async (raw) => { sent.push(raw); }));
after(() => {
  n.setEmailTransport(null);
  for (const f of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) if (existsSync(f)) unlinkSync(f);
});
beforeEach(async () => {
  sent.length = 0;
  delete process.env.SKIP_EMAIL;
  delete process.env.EMAIL_ALLOWLIST;
  for (const owner of ['_system', 'usr_ada']) for (const i of await db.getAllSyncData(owner)) await db.deleteSyncData(owner, i.dataKey);
});

const decodeParts = (raw) => [...raw.matchAll(/Content-Transfer-Encoding: base64\r\n\r\n([\s\S]*?)\r\n--/g)].map((m) => Buffer.from(m[1].replace(/\r\n/g, ''), 'base64').toString('utf8'));

describe('renderEmail', () => {
  const classroom = { name: 'AI <Leaders>', primary: '#123456' };
  it('fills variables, escapes them in HTML, keeps line breaks, and turns {{link}} into a button', () => {
    const r = n.renderEmail(
      { subject: 'Hi {{firstName}}\nthere', body: 'Hello {{firstName}} & <b>friends</b>.\n\n{{progressSummary}}\n\n{{link}}' },
      { firstName: '<script>x</script>', progressSummary: 'Line 1\nLine 2', link: 'https://x.org/a?b=1&c=2' },
      { classroom, linkLabel: 'Continue' },
    );
    assert.equal(r.subject, 'Hi <script>x</script> there', 'subject is one line (plain text, not HTML)');
    assert.match(r.text, /^Hello <script>x<\/script> & <b>friends<\/b>\.\n\nLine 1\nLine 2\n\nhttps:\/\/x\.org\/a\?b=1&c=2\n$/);
    assert.ok(r.html.includes('Hello &lt;script&gt;x&lt;/script&gt; &amp; &lt;b&gt;friends&lt;/b&gt;.'));
    assert.ok(r.html.includes('Line 1<br>Line 2'));
    assert.ok(r.html.includes('href="https://x.org/a?b=1&amp;c=2"') && r.html.includes('>Continue</a>'));
    assert.ok(r.html.includes('AI &lt;Leaders&gt;'), 'classroom name escaped in the wrapper');
    assert.ok(!r.html.includes('<script>'));
  });
  it('drops the button when there is no link, and empty paragraphs', () => {
    const r = n.renderEmail({ subject: 's', body: 'Hi\n\n{{newLessons}}\n\n{{link}}' }, { newLessons: '' }, {});
    assert.equal(r.text, 'Hi\n');
    assert.ok(!r.html.includes('<a href=""'));
  });
});

describe('validateTemplate', () => {
  it('accepts the defaults', () => {
    for (const [id, t] of Object.entries(n.TEMPLATES)) assert.equal(n.validateTemplate(id, t), null, id);
  });
  it('refuses unknown variables, multi-line or long subjects, empty bodies', () => {
    assert.match(n.validateTemplate('waitlist-confirmation', { subject: 'Hi {{lessonName}}', body: 'x' }), /Unknown variable: \{\{lessonName\}\}\. You can use \{\{firstName\}\}, \{\{classroomName\}\}/);
    assert.match(n.validateTemplate('waitlist-confirmation', { subject: 'a\nb', body: 'x' }), /one line/);
    assert.match(n.validateTemplate('waitlist-confirmation', { subject: 'x'.repeat(201), body: 'x' }), /at most 200/);
    assert.match(n.validateTemplate('waitlist-confirmation', { subject: 'x', body: '  ' }), /required/);
  });
});

describe('templates storage', () => {
  it('overrides, then resets to the default', async () => {
    const admin = { userId: 'usr_admin', username: 'admin' };
    assert.equal((await n.getTemplate('waitlist-confirmation', db)).isDefault, true);
    const { template } = await n.putTemplate('waitlist-confirmation', { subject: ' Thanks, {{firstName}} ', body: 'Body\r\n' }, admin, db);
    assert.deepEqual([template.subject, template.body, template.isDefault, template.updatedByName], ['Thanks, {{firstName}}', 'Body', false, 'admin']);
    assert.equal((await n.putTemplate('nope', { subject: 'x', body: 'y' }, admin, db)).status, 404);
    assert.equal((await n.resetTemplate('waitlist-confirmation', db)).template.subject, n.TEMPLATES['waitlist-confirmation'].subject);
  });
});

describe('automations', () => {
  it('are all off by default, and refuse unknown keys or non-booleans', async () => {
    assert.deepEqual(await n.readAutomations(db), { waitlistConfirmation: false, inactivityNudge: false, weeklyDigest: false });
    assert.deepEqual((await n.writeAutomations({ waitlistConfirmation: true }, db)).automations.waitlistConfirmation, true);
    assert.ok((await n.writeAutomations({ spam: true }, db)).error);
    assert.ok((await n.writeAutomations({ weeklyDigest: 'yes' }, db)).error);
  });
});

describe('unsubscribe tokens', () => {
  it('round-trip, and reject tampering and unknown kinds', () => {
    const t = n.unsubscribeToken('usr_ada', 'nudge');
    assert.deepEqual(n.verifyUnsubscribeToken(t), { userId: 'usr_ada', kind: 'nudge' });
    const [payload, mac] = t.split('.');
    const other = Buffer.from(JSON.stringify({ u: 'usr_bob', k: 'nudge' })).toString('base64url');
    assert.equal(n.verifyUnsubscribeToken(`${other}.${mac}`), null);
    assert.equal(n.verifyUnsubscribeToken(`${payload}.x${mac.slice(1)}`), null);
    assert.equal(n.verifyUnsubscribeToken(n.unsubscribeToken('usr_ada', 'everything')), null);
    assert.equal(n.verifyUnsubscribeToken(''), null);
  });
});

describe('emailAllowed', () => {
  it('allows everyone when unset; otherwise exact addresses and @domains', () => {
    assert.equal(n.emailAllowed('a@x.com', '', 'prod'), true);
    assert.equal(n.emailAllowed('A@X.com', 'a@x.com'), true);
    assert.equal(n.emailAllowed('b@uic.edu', 'a@x.com, @uic.edu'), true);
    assert.equal(n.emailAllowed('b@evil-uic.edu.com', '@uic.edu'), false);
    assert.equal(n.emailAllowed('b@x.com', 'a@x.com'), false);
  });
  it('with no allowlist, a non-prod stage sends to no one', () => {
    assert.equal(n.emailAllowed('a@x.com', '', 'playground'), false);
    assert.equal(n.emailAllowed('a@x.com', '', 'prod'), true);
    assert.equal(n.emailAllowed('a@x.com', '', undefined), true, 'local dev and older installs');
    assert.equal(n.emailAllowed('a@x.com', 'a@x.com', 'playground'), true);
  });
});

describe('buildMime', () => {
  it('is multipart text + HTML, encodes non-ASCII, and keeps every header on one line', () => {
    const raw = n.buildMime({ fromName: 'Aula "Uno"', fromAddress: 'no-reply@x.org', to: 'a@x.com\r\nBcc: evil@x.com', subject: 'Olá\r\nBcc: evil@x.com', text: 'plain ✓', html: '<p>html</p>', headers: { 'List-Unsubscribe': '<https://x/u>' } });
    const headerBlock = raw.split('\r\n\r\n')[0];
    assert.ok(!/^Bcc:/m.test(headerBlock), 'no injected header');
    assert.match(headerBlock, /^Subject: =\?UTF-8\?B\?/m);
    assert.match(headerBlock, /^From: "Aula Uno" <no-reply@x\.org>$/m);
    assert.match(headerBlock, /^List-Unsubscribe: <https:\/\/x\/u>$/m);
    assert.deepEqual(decodeParts(raw), ['plain ✓', '<p>html</p>']);
  });
});

describe('sendTemplated', () => {
  it('adds an unsubscribe link + one-click headers for a kind, and honors the opt-out', async () => {
    const r = await n.sendTemplated('inactivity-nudge', { to: 'ada@x.com', userId: 'usr_ada', kind: 'nudge', vars: { firstName: 'Ada', lessonName: 'Values', progress: '60%', link: 'https://x/l' } }, { db });
    assert.deepEqual(r, { sent: true });
    assert.equal(sent.length, 1);
    assert.match(sent[0], /^List-Unsubscribe: <http[^>]+\/v1\/unsubscribe\?token=[^>]+>$/m);
    assert.match(sent[0], /^List-Unsubscribe-Post: List-Unsubscribe=One-Click$/m);
    const [text, html] = decodeParts(sent[0]);
    assert.match(text, /It's been a week since you worked on Values/);
    assert.match(text, /To stop getting the inactivity reminder, unsubscribe: /);
    assert.match(html, /Unsubscribe<\/a>/);

    await n.setOptOut('usr_ada', { nudge: true }, db);
    assert.deepEqual(await n.sendTemplated('inactivity-nudge', { to: 'ada@x.com', userId: 'usr_ada', kind: 'nudge', vars: {} }, { db }), { optedOut: true });
    assert.equal(sent.length, 1);
  });
  it('one-time mail has no unsubscribe; the allowlist and SKIP_EMAIL stop sending', async () => {
    await n.sendTemplated('waitlist-confirmation', { to: 'w@x.com', vars: { firstName: 'Wes' } }, { db });
    assert.ok(!/List-Unsubscribe/.test(sent[0]));
    process.env.EMAIL_ALLOWLIST = '@uic.edu';
    assert.deepEqual(await n.sendTemplated('waitlist-confirmation', { to: 'w@x.com', vars: {} }, { db }), { blocked: true });
    delete process.env.EMAIL_ALLOWLIST;
    process.env.SKIP_EMAIL = 'true';
    assert.deepEqual(await n.sendTemplated('waitlist-confirmation', { to: 'w@x.com', vars: {} }, { db }), { skipped: true });
    assert.equal(sent.length, 1);
  });
  it('setOptOut refuses unknown kinds', async () => {
    assert.ok((await n.setOptOut('usr_ada', { all: true }, db)).error);
  });
});
