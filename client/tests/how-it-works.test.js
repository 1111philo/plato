import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { render } from '../../scripts/generate-how-it-works.js';

const DOC = join(dirname(fileURLToPath(import.meta.url)), '../../docs/HOW_IT_WORKS.md');

describe('docs/HOW_IT_WORKS.md', () => {
  it('is what the registry generates (run: node scripts/generate-how-it-works.js)', () => {
    assert.equal(readFileSync(DOC, 'utf8'), render());
  });

  it('covers every part of plato’s description of itself', () => {
    const doc = render();
    for (const heading of ['## The AI agents', '## What the coach is told before every reply', '## The rules plato’s code applies', '## What a Trace records', '## Outside services, and what each is sent']) {
      assert.ok(doc.includes(heading), heading);
    }
    assert.doesNotMatch(doc, /undefined|\[object Object\]/);
  });
});
