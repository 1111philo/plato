import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseAgentHeader } from '../js/agentHeader.js';

const PROMPTS = join(dirname(fileURLToPath(import.meta.url)), '../prompts');

describe('parseAgentHeader', () => {
  it('reads the fields of a prompt header', () => {
    const h = parseAgentHeader('<!--\n  AGENT: Lesson Owner\n  PURPOSE: Sets up.\n  RUNS: Once.\n  READS: a; b\n  RETURNS: c\n-->\nYou are…');
    assert.deepEqual(h, { name: 'Lesson Owner', purpose: 'Sets up.', runs: 'Once.', reads: ['a', 'b'], returns: ['c'] });
  });
  it('is null without a header or an AGENT line', () => {
    assert.equal(parseAgentHeader('You are the coach.'), null);
    assert.equal(parseAgentHeader('<!-- just a comment -->'), null);
    assert.equal(parseAgentHeader(null), null);
  });
  it('every prompt file has a complete header', () => {
    for (const f of readdirSync(PROMPTS).filter((x) => x.endsWith('.md'))) {
      const h = parseAgentHeader(readFileSync(join(PROMPTS, f), 'utf8'));
      assert.ok(h, f);
      for (const k of ['name', 'purpose', 'runs']) assert.ok(h[k], `${f}: ${k}`);
      assert.ok(h.reads.length && h.returns.length, `${f}: READS and RETURNS`);
    }
  });
});
