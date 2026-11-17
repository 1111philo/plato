/**
 * Single sign-on end to end: the real routes, the real account rules, the
 * Entra plugin's provider, a real SQLite database, and a fake identity
 * provider that signs real ID tokens (tests/helpers/fake-idp.js).
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { unlinkSync, existsSync } from 'node:fs';
import { Hono } from 'hono';
import { startFakeIdp } from '../helpers/fake-idp.js';

const DB = './data/test-sso.db';
const TENANT = '11111111-2222-3333-4444-555555555555';
process.env.DB_BACKEND = 'sqlite';
process.env.SQLITE_PATH = DB;
process.env.APP_URL = 'http://localhost:3999';
process.env.SKIP_EMAIL = 'true';
for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) if (existsSync(f)) unlinkSync(f);

const { default: db } = await import('../../src/lib/db.js');
const { default: sso } = await import('../../src/routes/sso.js');
const { default: auth } = await import('../../src/routes/auth.js');
const { default: waitlist } = await import('../../src/routes/waitlist.js');
const { default: admin } = await import('../../src/routes/admin.js');
const { default: me } = await import('../../src/routes/me.js');
const { _setProviders } = await import('../../src/lib/sso-providers.js');
const { _resetOidcCache } = await import('../../src/lib/oidc.js');
const { provider: entra } = await import('../../../plugins/entra-sso/server/provider.js');
const { hashPassword } = await import('../../src/lib/password.js');
const { signAccessToken } = await import('../../src/lib/jwt.js');

const origLog = console.log; const origWarn = console.warn; const origErr = console.error;
let idp;
const app = new Hono();
for (const r of [sso, auth, waitlist, admin, me]) app.route('/', r);

before(async () => {
  console.log = () => {}; console.warn = () => {}; console.error = () => {};
  idp = await startFakeIdp({ tenant: TENANT, clientId: 'client-1', clientSecret: 's3cret' });
  Object.assign(process.env, { SSO_ENTRA_TENANT_ID: TENANT, SSO_ENTRA_CLIENT_ID: 'client-1', SSO_ENTRA_CLIENT_SECRET: 's3cret', SSO_ENTRA_DOMAINS: 'uic.edu', SSO_ENTRA_AUTHORITY: idp.base });
  _setProviders([{ ...entra, settings: { buttonLabel: 'Sign in with UIC' } }]);
  await db.putSyncData('_system', 'settings', { userGroups: ['Cohort A'], userFields: [{ id: 'fld_org', label: 'Org', type: 'text', required: false }] }, 0);
  await db.putSyncData('_system', 'waitlist', { open: true }, 0);
  await db.createUser({ userId: 'usr_admin', email: 'boss@uic.edu', username: 'boss', passwordHash: await hashPassword('admin-pass-1'), firstName: 'Boss', lastName: '', name: 'Boss', role: 'admin' });
  await db.createUser({ userId: 'usr_gmail', email: 'pat@gmail.com', username: 'pat', passwordHash: await hashPassword('pat-pass-123'), firstName: 'Pat', lastName: '', name: 'Pat', role: 'learner' });
});
after(async () => {
  await idp.close();
  console.log = origLog; console.warn = origWarn; console.error = origErr;
  for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) if (existsSync(f)) unlinkSync(f);
});
beforeEach(() => { _resetOidcCache(); });

const cookieFrom = (res) => (res.headers.get('set-cookie') || '').split(';')[0];
const person = (netid, extra = {}) => ({ oid: `oid-${netid}`, sub: `sub-${netid}`, email: `${netid}@uic.edu`, preferred_username: `${netid}@uic.edu`, given_name: netid, family_name: 'Tester', name: `${netid} Tester`, ...extra });

/** Start → provider approves → callback. Returns the callback response and the cookie. */
async function signIn(claims, { query = '', tamper, cookieOverride, headers = {}, link } = {}) {
  let start; let cookie; let authorize;
  if (link) {
    start = await app.request('/v1/auth/sso/entra/link', { method: 'POST', headers: { Authorization: `Bearer ${link}` } });
    assert.equal(start.status, 200);
    authorize = (await start.json()).url;
  } else {
    start = await app.request(`/v1/auth/sso/entra/start${query}`, { headers });
    assert.equal(start.status, 302);
    authorize = start.headers.get('location');
  }
  cookie = cookieFrom(start);
  const { code, state } = idp.approve(authorize, claims, tamper);
  const callback = await app.request(`/v1/auth/sso/entra/callback?code=${code}&state=${state}`, { headers: { cookie: cookieOverride ?? cookie } });
  return { callback, cookie, authorize, start };
}
/** The whole flow, through the app's exchange. Returns the exchange JSON (or the login redirect reason). */
async function complete(claims, opts = {}) {
  const { callback, cookie } = await signIn(claims, opts);
  const location = callback.headers.get('location');
  if (!location.includes('/sso/complete#code=')) return { redirect: location };
  const code = location.split('#code=')[1];
  const res = await app.request('/v1/auth/sso/exchange', { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ code }) });
  return { status: res.status, code, cookie, ...(await res.json()) };
}

describe('the flow', () => {
  it('lists the provider only when the deployment configured it', async () => {
    assert.deepEqual(await (await app.request('/v1/auth/sso/providers')).json(), { providers: [{ id: 'entra', label: 'Sign in with UIC' }] });
    const secret = process.env.SSO_ENTRA_CLIENT_SECRET;
    delete process.env.SSO_ENTRA_CLIENT_SECRET;
    assert.deepEqual(await (await app.request('/v1/auth/sso/providers')).json(), { providers: [] });
    assert.match((await app.request('/v1/auth/sso/entra/start')).headers.get('location'), /\/login\?sso=unavailable$/);
    process.env.SSO_ENTRA_CLIENT_SECRET = secret;
    process.env.SSO_ENTRA_TENANT_ID = 'common'; // never "any Microsoft account"
    assert.deepEqual(await (await app.request('/v1/auth/sso/providers')).json(), { providers: [] });
    process.env.SSO_ENTRA_TENANT_ID = TENANT;
  });

  it('start redirects with state, nonce, and PKCE, and an HttpOnly cookie; `next` can’t leave the site', async () => {
    const res = await app.request('/v1/auth/sso/entra/start?next=https://evil.example/x');
    const url = new URL(res.headers.get('location'));
    assert.equal(url.origin, idp.base);
    const q = url.searchParams;
    assert.equal(q.get('response_type'), 'code');
    assert.equal(q.get('client_id'), 'client-1');
    assert.equal(q.get('redirect_uri'), 'http://localhost:3999/v1/auth/sso/entra/callback');
    assert.equal(q.get('code_challenge_method'), 'S256');
    assert.ok(q.get('state').length >= 40 && q.get('nonce').length >= 40 && q.get('code_challenge').length >= 40);
    assert.equal(q.get('scope'), 'openid profile email');
    assert.ok(!url.toString().includes('s3cret'));
    const set = res.headers.get('set-cookie');
    assert.match(set, /plato_sso_tx=/); assert.match(set, /HttpOnly/); assert.match(set, /SameSite=Lax/); assert.match(set, /Path=\/v1\/auth\/sso/);
    const again = await app.request('/v1/auth/sso/entra/start');
    assert.notEqual(new URL(again.headers.get('location')).searchParams.get('state'), q.get('state'), 'fresh per attempt');
    const out = await complete(person('nextcheck'), { query: '?next=https://evil.example/x' });
    assert.equal(out.next, '/');
  });

  it('refuses a callback without our cookie, with someone else’s state, or after a cancel', async () => {
    const { authorize, cookie } = await signIn(person('x1'));
    const { code, state } = idp.approve(authorize, person('x1'));
    const reason = async (url, headers) => (await app.request(url, { headers })).headers.get('location');
    assert.match(await reason(`/v1/auth/sso/entra/callback?code=${code}&state=${state}`, {}), /sso=expired/);
    assert.match(await reason(`/v1/auth/sso/entra/callback?code=${code}&state=forged`, { cookie }), /sso=expired/);
    assert.match(await reason(`/v1/auth/sso/entra/callback?error=access_denied&state=${state}`, { cookie }), /sso=cancelled/);
    assert.match(await reason(`/v1/auth/sso/other/callback?code=${code}&state=${state}`, { cookie }), /sso=expired/);
  });

  it('rejects a token from another tenant, with the wrong audience, issuer, key, nonce, or past its expiry', async () => {
    assert.match((await complete(person('t1', { tid: '99999999-2222-3333-4444-555555555555' }))).redirect, /sso=refused/);
    for (const tamper of [{ audience: 'another-app' }, { issuer: `${idp.base}/other/v2.0` }, { wrongKey: true }, { nonce: 'replayed' }, { expired: true }]) {
      assert.match((await complete(person('t2'), { tamper })).redirect, /sso=failed/, JSON.stringify(tamper));
    }
    assert.equal(await db.getUserByEmail('t1@uic.edu'), null);
    assert.equal(await db.getUserByEmail('t2@uic.edu'), null);
  });

  it('the one-time code works once, only with this browser’s cookie, and is not a refresh token', async () => {
    await db.createInvite({ inviteToken: 'inv_code_test', email: 'codetest@uic.edu', invitedBy: 'usr_admin' });
    const a = await signIn(person('codetest'));
    const code = a.callback.headers.get('location').split('#code=')[1];
    assert.ok(!a.callback.headers.get('location').includes('accessToken'));
    const post = (cookie, body) => app.request('/v1/auth/sso/exchange', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
    const asRefresh = await app.request('/v1/auth/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: code }) });
    assert.equal(asRefresh.status, 401);
    const other = await app.request('/v1/auth/sso/entra/start');
    assert.equal((await post(cookieFrom(other), { code })).status, 400, 'another browser’s cookie');
    // That attempt consumed the code: a stolen code can't be tried twice.
    assert.equal((await post(a.cookie, { code })).status, 400);
    const b = await signIn(person('codetest'));
    const code2 = b.callback.headers.get('location').split('#code=')[1];
    assert.equal((await post(null, { code: code2 })).status, 400, 'no cookie');
    const c = await complete(person('codetest'));
    assert.equal(c.outcome, 'signed_in');
    assert.ok(c.accessToken && c.refreshToken);
    assert.equal((await post(c.cookie, { code: c.code })).status, 400, 'single use');
  });
});

describe('which account you land in', () => {
  it('no account, no invite: nobody is created; the wait-list ticket carries the verified address', async () => {
    const out = await complete(person('newbie'));
    assert.equal(out.outcome, 'no_account');
    assert.equal(out.onWaitlist, false);
    assert.equal(out.waitlistOpen, true);
    assert.deepEqual([out.email, out.firstName, out.accessToken], ['newbie@uic.edu', 'newbie', undefined]);
    assert.equal(await db.getUserByEmail('newbie@uic.edu'), null);
    // Join with the ticket: the email is the verified one whatever the form says.
    const join = await app.request('/v1/waitlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ firstName: 'New', lastName: 'Bie', email: 'someone-else@uic.edu', ssoTicket: out.ticket }) });
    assert.ok(join.status < 300, `join ${join.status}`);
    const entry = await db.getWaitlistEntryByEmail('newbie@uic.edu');
    assert.equal(entry.profile.ssoVerified.provider, 'entra');
    assert.equal(await db.getWaitlistEntryByEmail('someone-else@uic.edu'), null);
    const bad = await app.request('/v1/waitlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ firstName: 'X', email: 'x@uic.edu', ssoTicket: `${out.ticket}x` }) });
    assert.equal(bad.status, 400);
  });

  it('on the wait list: still no account; the entry is marked verified', async () => {
    await db.createWaitlistEntry({ inviteToken: 'wl_w1', email: 'waiter@uic.edu', profile: { firstName: 'Wai', lastName: 'Ter', userGroup: 'Cohort A' } });
    const out = await complete(person('waiter'));
    assert.deepEqual([out.outcome, out.onWaitlist, out.ticket], ['no_account', true, null]);
    assert.equal((await db.getInvite('wl_w1')).profile.ssoVerified.provider, 'entra');
    assert.equal((await db.getInvite('wl_w1')).profile.userGroup, 'Cohort A');
    assert.equal(await db.getUserByEmail('waiter@uic.edu'), null);
  });

  it('has an invite (even an expired one): the account is made from it, with no password', async () => {
    await db.createInvite({ inviteToken: 'inv_i1', email: 'invitee@uic.edu', invitedBy: 'usr_admin', profile: { firstName: 'Inga', lastName: 'Vited', userGroup: 'Cohort A', customFields: { fld_org: 'UIC', fld_gone: 'x' } } });
    const { default: Database } = await import('better-sqlite3');
    const raw = new Database(DB); raw.prepare("UPDATE invites SET expiresAt = ? WHERE inviteToken = 'inv_i1'").run(Math.floor(Date.now() / 1000) - 60); raw.close();
    const out = await complete(person('invitee'));
    assert.deepEqual([out.outcome, out.created, out.user.role], ['signed_in', true, 'learner']);
    const user = await db.getUserByEmail('invitee@uic.edu');
    assert.deepEqual([user.firstName, user.lastName, user.userGroup, user.customFields], ['Inga', 'Vited', 'Cohort A', { fld_org: 'UIC' }]);
    assert.ok(!user.passwordHash);
    assert.equal(user.ssoKey, `entra:${TENANT}:oid-invitee`);
    assert.equal((await db.getInvite('inv_i1')).status, 'used');
    // Password sign-in for an account with no password: refused, not an error.
    const login = await app.request('/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'invitee@uic.edu', password: 'anything-at-all' }) });
    assert.equal(login.status, 401);
    // /v1/me shows the sign-in methods.
    const meRes = await (await app.request('/v1/me', { headers: { Authorization: `Bearer ${out.accessToken}` } })).json();
    assert.deepEqual(meRes.signIn, { password: false, sso: { provider: 'entra', email: 'invitee@uic.edu' } });
  });

  it('a new account’s name comes whole from the invite, or whole from the provider, never mixed', async () => {
    await db.createInvite({ inviteToken: 'inv_n1', email: 'cher@uic.edu', invitedBy: 'usr_admin', profile: { firstName: 'Cher' } }); // no last name on purpose
    await db.createInvite({ inviteToken: 'inv_n2', email: 'legacy@uic.edu', invitedBy: 'usr_admin', profile: { name: 'Lee Gacy Jr' } }); // older single-name profile
    await db.createInvite({ inviteToken: 'inv_n3', email: 'plain@uic.edu', invitedBy: 'usr_admin' }); // a plain invite: no name
    await complete(person('cher'));
    await complete(person('legacy'));
    await complete(person('plain'));
    const names = async (email) => { const u = await db.getUserByEmail(email); return [u.firstName, u.lastName]; };
    assert.deepEqual(await names('cher@uic.edu'), ['Cher', ''], 'not "Cher Tester"');
    assert.deepEqual(await names('legacy@uic.edu'), ['Lee', 'Gacy Jr']);
    assert.deepEqual(await names('plain@uic.edu'), ['plain', 'Tester'], 'from the provider');
  });

  it('an existing account with the same uic.edu email is connected (staff too), and the link then wins over email', async () => {
    const out = await complete(person('boss'));
    assert.deepEqual([out.outcome, out.linked, out.user.userId, out.user.role], ['signed_in', true, 'usr_admin', 'admin']);
    assert.ok((await db.getUserById('usr_admin')).passwordHash, 'the password still works');
    await db.updateUser('usr_admin', { email: 'boss-renamed@uic.edu' });
    const again = await complete(person('boss', { email: 'someone.new@uic.edu', preferred_username: 'someone.new@uic.edu' }));
    assert.deepEqual([again.outcome, again.user.userId, !!again.linked], ['signed_in', 'usr_admin', false]);
    await db.updateUser('usr_admin', { email: 'boss@uic.edu' });
    // A different UIC person can't take an account that already has an identity.
    const thief = await complete(person('impostor', { email: 'boss@uic.edu', preferred_username: 'boss@uic.edu' }));
    assert.deepEqual([thief.outcome, thief.code], ['error', 'account_has_identity']);
  });

  it('an address outside the tenant’s domains never matches an account', async () => {
    const guest = await complete(person('guest', { email: 'pat@gmail.com', preferred_username: 'pat_gmail.com#EXT#@uic.onmicrosoft.com' }));
    assert.equal(guest.outcome, 'no_account');
    assert.equal(guest.ticket, null, 'nothing vouched for, so no verified wait-list join');
    assert.ok(!(await db.getUserById('usr_gmail')).ssoKey);
    const unverified = await complete(person('edov', { email: 'boss@uic.edu', xms_edov: false, preferred_username: 'edov@elsewhere.org' }));
    assert.equal(unverified.outcome, 'no_account');
  });

  it('from an invite link: the account keeps the invite’s email; an expired link is refused; a shareable link counts usage', async () => {
    await db.createInvite({ inviteToken: 'inv_gmail_1', email: 'robin@gmail.com', invitedBy: 'usr_admin', profile: { firstName: 'Robin', lastName: 'G' } });
    const out = await complete(person('robin'), { query: '?invite=inv_gmail_1' });
    assert.deepEqual([out.outcome, out.user.email, out.created], ['signed_in', 'robin@gmail.com', true]);
    assert.equal((await db.getUserByEmail('robin@gmail.com')).ssoEmail, 'robin@uic.edu');
    assert.equal(await db.getUserByEmail('robin@uic.edu'), null);

    await db.createInvite({ inviteToken: 'inv_gmail_old', email: 'old@gmail.com', invitedBy: 'usr_admin' });
    const { default: Database } = await import('better-sqlite3');
    const raw = new Database(DB); raw.prepare("UPDATE invites SET expiresAt = ? WHERE inviteToken = 'inv_gmail_old'").run(Math.floor(Date.now() / 1000) - 60); raw.close();
    const expired = await complete(person('oldlink'), { query: '?invite=inv_gmail_old' });
    assert.deepEqual([expired.outcome, expired.code], ['error', 'invite_invalid']);
    assert.equal(await db.getUserByEmail('old@gmail.com'), null);

    await db.createInvite({ inviteToken: 'inv_link_1', invitedBy: 'usr_admin', isLink: true, maxUsages: 1 });
    const first = await complete(person('linkone'), { query: '?invite=inv_link_1' });
    assert.deepEqual([first.outcome, first.user.email], ['signed_in', 'linkone@uic.edu']);
    const second = await complete(person('linktwo'), { query: '?invite=inv_link_1' });
    assert.equal(second.outcome, 'error');
    assert.equal(await db.getUserByEmail('linktwo@uic.edu'), null);
  });

  it('connect from Settings, refuse an identity that belongs to another account, and disconnect only with a password', async () => {
    const token = await signAccessToken('usr_gmail', 'learner');
    const linked = await complete(person('patuic'), { link: token });
    assert.deepEqual([linked.outcome, linked.next], ['linked', '/settings']);
    assert.equal((await db.getUserById('usr_gmail')).ssoKey, `entra:${TENANT}:oid-patuic`);
    const viaUic = await complete(person('patuic'));
    assert.equal(viaUic.user.userId, 'usr_gmail', 'UIC sign-in now lands in the Gmail account');
    // The same UIC identity can't be connected to a second account.
    const adminToken = await signAccessToken('usr_admin', 'admin');
    await db.clearUserSso('usr_admin');
    const taken = await complete(person('patuic'), { link: adminToken });
    assert.deepEqual([taken.outcome, taken.code], ['error', 'identity_in_use']);
    // Disconnect: fine with a password, refused without one.
    const off = await app.request('/v1/auth/sso/disconnect', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    assert.equal(off.status, 200);
    assert.ok(!(await db.getUserById('usr_gmail')).ssoKey);
    const ssoOnly = await db.getUserByEmail('invitee@uic.edu');
    const stuck = await app.request('/v1/auth/sso/disconnect', { method: 'POST', headers: { Authorization: `Bearer ${await signAccessToken(ssoOnly.userId, 'learner')}` } });
    assert.equal(stuck.status, 400);
    assert.ok((await db.getUserById(ssoOnly.userId)).ssoKey);
    // An admin can unlink anyone; the list shows sign-in methods.
    const list = await (await app.request('/v1/admin/users', { headers: { Authorization: `Bearer ${adminToken}` } })).json();
    const row = list.find((u) => u.userId === ssoOnly.userId);
    assert.deepEqual([row.sso.provider, row.sso.email, row.hasPassword], ['entra', 'invitee@uic.edu', false]);
    const unlink = await app.request(`/v1/admin/users/${ssoOnly.userId}/sso`, { method: 'DELETE', headers: { Authorization: `Bearer ${adminToken}` } });
    assert.deepEqual(await unlink.json(), { ok: true, hasPassword: false });
    assert.ok(!(await db.getUserById(ssoOnly.userId)).ssoKey);
    assert.equal((await app.request('/v1/auth/sso/entra/link', { method: 'POST' })).status, 401, 'connecting needs a session');
  });
});
