/**
 * Learner language for AI agents (#240): which browsers get a directive,
 * and that the directive protects the literals plato's code parses.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { learnerLanguageName, languageDirective, withLanguage } from '../js/language.js';

describe('learnerLanguageName', () => {
  it('maps a regional code to its language', () => {
    assert.equal(learnerLanguageName({ language: 'es-MX' }), 'Spanish');
    assert.equal(learnerLanguageName({ language: 'pt-BR' }), 'Portuguese');
    assert.equal(learnerLanguageName({ language: 'ZH-tw' }), 'Chinese');
  });

  it('prefers the first of navigator.languages', () => {
    assert.equal(learnerLanguageName({ languages: ['fr-CA', 'en-US'], language: 'en-US' }), 'French');
  });

  it('is null for English, unmapped languages, and no navigator', () => {
    assert.equal(learnerLanguageName({ language: 'en-US' }), null);
    assert.equal(learnerLanguageName({ language: 'en' }), null);
    assert.equal(learnerLanguageName({ language: 'xx-YY' }), null);
    assert.equal(learnerLanguageName({}), null);
    assert.equal(learnerLanguageName(undefined), null);
  });
});

describe('languageDirective', () => {
  it('is empty without a language', () => {
    assert.equal(languageDirective(null), '');
  });

  it('names the language and every literal plato parses', () => {
    const d = languageDirective('Spanish');
    assert.match(d, /## Language/);
    assert.match(d, /reads Spanish/);
    for (const literal of ['[PROGRESS: N]', '[KB_UPDATE:', '[PROFILE_UPDATE:', '[READINESS: N]', '[DRAFT]',
      'JSON keys', '## Learning Objectives', '## Exemplar', '## Coach Directive', '"- Can "']) {
      assert.ok(d.includes(literal), `directive mentions ${literal}`);
    }
  });
});

describe('withLanguage', () => {
  it('leaves an English learner\'s prompt byte-for-byte unchanged', () => {
    assert.equal(withLanguage('PROMPT', { language: 'en-US' }), 'PROMPT');
    assert.equal(withLanguage('PROMPT', undefined), 'PROMPT');
  });

  it('appends the directive for other languages', () => {
    const out = withLanguage('PROMPT', { language: 'de-DE' });
    assert.ok(out.startsWith('PROMPT\n\n---\n\n## Language'));
    assert.match(out, /German/);
  });
});
