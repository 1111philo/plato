/**
 * Guards on server/template.yaml that only a real deploy would otherwise catch.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const template = readFileSync(new URL('../../template.yaml', import.meta.url), 'utf8');
// Each function's block, from its logical id to the next top-level resource.
const fn = (name) => template.split(new RegExp(`^  ${name}:$`, 'm'))[1].split(/^ {2}\S/m)[0];

describe('template.yaml', () => {
  for (const name of ['PlatoApiFunction', 'PlatoStreamFunction']) {
    it(`${name} may send raw email (notifications use SES SendRawEmail)`, () => {
      assert.match(fn(name), /- ses:SendRawEmail/);
      assert.match(fn(name), /- ses:SendEmail/);
    });
  }
  it('creates no EventBridge rules (the deploy role in docs/DEPLOY.md cannot)', () => {
    assert.doesNotMatch(template, /Type: Schedule|AWS::Events::Rule/);
  });
});
