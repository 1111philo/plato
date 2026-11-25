/**
 * The product's name is always **plato**: bold and lowercase (Blake,
 * 2026-11-25). lib/brand.js finds it in text and leaves identifiers alone.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { brandHtml, brandParts } from '../src/lib/brand.js';

describe('the name in text, and not in identifiers', () => {
  it('bolds the word a person reads', () => {
    assert.equal(brandHtml('plato supports text, and plato’s code checks it. Powered by <a href="https://github.com/1111philo/plato">plato</a>.'),
      '<strong>plato</strong> supports text, and <strong>plato</strong>’s code checks it. Powered by <a href="https://github.com/1111philo/plato"><strong>plato</strong></a>.');
  });
  it('leaves names, paths, addresses, code and existing bold alone', () => {
    for (const s of ['plato-users', '/plato/lessons', 'plato.courses', 'plato_auth', '1111philo/plato', '<code>plato</code>', '<strong>plato</strong>', '**plato**']) {
      assert.equal(brandHtml(s), s, s);
    }
  });
  it('splits text for React', () => {
    assert.deepEqual(brandParts('Where plato stepped in'), ['Where ', { brand: true }, ' stepped in']);
    assert.deepEqual(brandParts('plato-users'), ['plato-users']);
  });
});

describe('the docs say **plato** (scripts/brand-docs.js)', () => {
  it('every tracked markdown file outside the agent prompts already has the name bold', async () => {
    const { execFileSync } = await import('node:child_process');
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { brandMarkdown } = await import('../../scripts/brand-docs.js');
    const root = fileURLToPath(new URL('../..', import.meta.url));
    const files = execFileSync('git', ['ls-files', '*.md'], { cwd: root, encoding: 'utf8' }).split('\n')
      .filter((f) => f && !/(^|\/)prompts\//.test(f) && !f.startsWith('evals/'));
    const plain = files.filter((f) => { const t = readFileSync(`${root}/${f}`, 'utf8'); return brandMarkdown(t) !== t; });
    assert.deepEqual(plain, [], 'run: node scripts/brand-docs.js <file>');
  });
});
