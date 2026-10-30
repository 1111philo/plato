/**
 * Email rendering (src/lib/email.js): admin- and user-controlled values
 * (classroom name, inviter name, theme color) must not inject HTML, CSS, or
 * mail headers.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, safeColor, fromHeader, inviteEmailHtml, resetEmailHtml } from '../../src/lib/email.js';

describe('email escaping', () => {
  it('escapes HTML metacharacters', () => {
    assert.equal(escapeHtml('<b>"Tom" & \'Jerry\'</b>'), '&lt;b&gt;&quot;Tom&quot; &amp; &#39;Jerry&#39;&lt;/b&gt;');
    assert.equal(escapeHtml(null), '');
  });

  it('only accepts hex colors for inline CSS', () => {
    assert.equal(safeColor('#1a2b3c'), '#1a2b3c');
    assert.equal(safeColor('#abc'), '#abc');
    assert.equal(safeColor('red; background:url(x)'), '#470d99');
    assert.equal(safeColor(undefined), '#470d99');
  });

  it('builds a From header that cannot break out of the display name', () => {
    assert.equal(fromHeader('UIC Classroom', 'no-reply@x.org'), '"UIC Classroom" <no-reply@x.org>');
    assert.equal(fromHeader('Evil"\r\nBcc: a@b.c <x>', 'no-reply@x.org'), '"EvilBcc: a@b.c x" <no-reply@x.org>');
    assert.equal(fromHeader('', 'no-reply@x.org'), '"plato" <no-reply@x.org>');
  });

  it('invite email escapes the classroom and inviter names', () => {
    const html = inviteEmailHtml({ name: '<script>x</script>', primary: 'red;}' }, 'https://app/signup?token=inv_1', '<img src=x onerror=1>');
    assert.ok(!html.includes('<script>'));
    assert.ok(!html.includes('<img src=x'));
    assert.ok(html.includes('&lt;img src=x onerror=1&gt; has invited you'));
    assert.ok(html.includes('background: #470d99'), 'unsafe color replaced');
    assert.ok(html.includes('href="https://app/signup?token=inv_1"'));
  });

  it('invite email without an inviter name', () => {
    assert.match(inviteEmailHtml({ name: 'C', primary: '#123456' }, 'u', null), /You've been invited/);
  });

  it('reset email escapes the classroom name', () => {
    const html = resetEmailHtml({ name: 'A & B', primary: '#123' }, 'https://app/reset?reset=rst_1');
    assert.ok(html.includes('A &amp; B'));
  });
});
