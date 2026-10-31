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

// [file, a substring of the exact class list allowed, reason]. Per class
// list, not per file, so a new control in the same file is still checked.
const ALLOWED = [
  ['src/components/ProfileCompletionGate.jsx', 'outline-none', 'tabIndex=-1 heading, focused only by script to move the reading position'],
  ['src/components/chat/ComposeBar.jsx', 'outline-none', 'the textarea’s box shows the ring with focus-within'],
  ['src/components/ui/dialog.jsx', 'outline-none', 'the dialog container takes focus only on open; it isn’t a Tab stop'],
  ['src/components/ui/alert-dialog.jsx', 'outline-none', 'the dialog container takes focus only on open; it isn’t a Tab stop'],
  ['src/components/ui/dropdown-menu.jsx', 'isolate z-50 outline-none', 'the menu positioner wrapper is never focused itself'],
  ['src/components/ui/dropdown-menu.jsx', 'bg-popover p-1', 'the menu popup holds focus only as it opens; arrow keys move to items, which show focus:bg-accent'],
];

// Ways to remove the outline: Tailwind v3/v4 utilities, arbitrary values.
const REMOVES = /\b(outline-none|outline-hidden|outline-0)\b|\[outline:(none|0)\]/;
// A focus style that's actually visible: a ring, an outline, a border, a
// shadow, an underline, or a background highlight (menu items, the roving
// highlight a listbox uses). A bare `focus:outline-none` doesn't count.
const SHOWS = /\bfocus(-visible|-within)?:(ring|outline-(?!none|hidden|0)|border|shadow|underline|bg-)/;

function files(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.jsx?$/.test(f) ? [p] : [];
  });
}

describe('focus styles', () => {
  const root = new URL('..', import.meta.url).pathname;
  const sources = ['src', '../plugins'].flatMap((d) => files(join(root, d)))
    .filter((f) => !f.includes('node_modules'))
    .map((f) => ({ rel: f.slice(root.length), text: readFileSync(f, 'utf8') }));

  it('no class list removes the outline without a visible focus style of its own', () => {
    const bad = [];
    for (const { rel, text } of sources) {
      for (const m of text.matchAll(/(["'`])([^"'`\n]*)\1/g)) {
        const cls = m[2];
        if (!REMOVES.test(cls) || SHOWS.test(cls)) continue;
        if (ALLOWED.some(([f, sub]) => f === rel && cls.includes(sub))) continue;
        bad.push(`${rel}: "${cls}"`);
      }
    }
    assert.deepEqual(bad, []);
  });

  it('no inline style removes the outline', () => {
    const bad = sources.filter(({ text }) => /outline:\s*['"`]?(none|0)\b/.test(text.replace(/\[outline:(none|0)\]/g, '')))
      .map(({ rel }) => rel);
    assert.deepEqual(bad, []);
  });

  it('the matchers catch what they should', () => {
    assert.ok(REMOVES.test('outline-hidden') && REMOVES.test('[outline:none]') && REMOVES.test('a outline-none b'));
    assert.ok(!SHOWS.test('focus:outline-none'));
    assert.ok(SHOWS.test('focus-visible:ring-2') && SHOWS.test('focus:bg-accent'));
  });
});
