/**
 * Visible focus guard (#451 review M13). Tailwind's `outline-none` beats the
 * global *:focus-visible ring (index.css), so a class list that removes the
 * outline must put back its own focus style (focus:, focus-visible:, or
 * focus-within:). The only exceptions are listed below, each with its reason.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ALLOWED = {
  'src/components/ProfileCompletionGate.jsx': 'tabIndex=-1 heading, focused only by script to move the reading position',
  'src/components/ui/dropdown-menu.jsx': 'the menu positioner wrapper is never focused itself',
  'src/components/chat/ComposeBar.jsx': 'the textarea’s box shows the ring with focus-within',
  'src/components/ui/dialog.jsx': 'the dialog container takes focus only on open; it isn’t a Tab stop',
  'src/components/ui/alert-dialog.jsx': 'the dialog container takes focus only on open; it isn’t a Tab stop',
};

function files(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.jsx?$/.test(f) ? [p] : [];
  });
}

describe('focus styles', () => {
  it('no class list removes the outline without its own focus style', () => {
    const root = new URL('..', import.meta.url).pathname;
    const bad = [];
    for (const dir of ['src', '../plugins']) {
      for (const file of files(join(root, dir))) {
        if (file.includes('node_modules')) continue;
        const rel = file.slice(root.length);
        const text = readFileSync(file, 'utf8');
        for (const m of text.matchAll(/(["'`])([^"'`\n]*\boutline-none\b[^"'`\n]*)\1/g)) {
          if (/\bfocus(-visible|-within)?:/.test(m[2])) continue;
          if (ALLOWED[rel]) continue;
          bad.push(`${rel}: "${m[2]}"`);
        }
      }
    }
    assert.deepEqual(bad, []);
  });
});
