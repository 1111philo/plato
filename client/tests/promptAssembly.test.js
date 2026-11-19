import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assembleSystemPrompt, splitAtMarker, AFTER_CONTEXT_MARKER, COACH_KB_NOTE } from '../js/promptAssembly.js';

describe('assembleSystemPrompt (#584)', () => {
  it('puts the part after the marker after the knowledge base and catalog, then the addendum, then the language', () => {
    const out = assembleSystemPrompt({
      prompt: `RULES\n${AFTER_CONTEXT_MARKER}\nLAST`, kb: 'KB', kbNote: 'NOTE', catalog: '- A',
      addendum: 'ADD', languageDirective: '\n\nLANG',
    });
    const order = ['RULES', 'NOTE', 'KB', '- A', 'LAST', 'ADD', 'LANG'].map((s) => out.indexOf(s));
    assert.deepEqual([...order].sort((a, b) => a - b), order);
    assert.equal(out.includes(AFTER_CONTEXT_MARKER), false);
  });

  it('keeps a prompt without the marker as it was (other agents)', () => {
    assert.equal(
      assembleSystemPrompt({ prompt: 'P', kb: 'KB', catalog: '- A', catalogHeading: 'Current Lessons in This Classroom' }),
      'P\n\n---\n\n## Program Knowledge Base\n\nKB\n\n---\n\n## Current Lessons in This Classroom\n\n- A',
    );
  });

  it('the coach prompt has its closing rules after the marker, and they mention the lesson focus', () => {
    const coach = readFileSync(new URL('../prompts/coach.md', import.meta.url), 'utf8');
    const { after } = splitAtMarker(coach);
    assert.match(after, /^## Before you reply/);
    assert.match(after, /Agreeing isn't evidence/);
    assert.match(after, /portfolio/);
    assert.match(COACH_KB_NOTE, /does not set this lesson's focus/);
  });
});
