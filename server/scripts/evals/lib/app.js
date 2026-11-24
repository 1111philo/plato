/**
 * plato's own code, loaded from a checkout (`root`): the candidate (this
 * working tree) or the baseline (a worktree of `origin/main`). The agents are
 * built, called and checked with whatever that version has, so the same
 * harness measures both. A module or export a version doesn't have is
 * `undefined`, and the agent module falls back the way that version does
 * (for example, no grading check before #584).
 *
 * The engine is browser code; it loads in Node with these stubs, as its tests do.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {}, clear() {} };
globalThis.fetch ??= async () => ({ ok: false, status: 404, json: async () => ({}) });

const tryImport = async (path) => (existsSync(path) ? import(pathToFileURL(path).href) : {});

/** Everything an agent module needs from one version of plato. */
export async function loadApp(root) {
  const c = (p) => join(root, 'client', p);
  const [engine, assessment, orchestrator, assembly, language, validators, work, creation, markdown, notes] = await Promise.all([
    tryImport(c('src/lib/lessonEngine.js')),
    tryImport(c('src/lib/assessment.js')),
    tryImport(c('js/orchestrator.js')),
    tryImport(c('js/promptAssembly.js')),
    tryImport(c('js/language.js')),
    tryImport(c('js/validators.js')),
    tryImport(c('src/lib/lessonWork.js')),
    tryImport(c('src/lib/lessonCreationEngine.js')),
    tryImport(join(root, 'server/src/lib/lesson-markdown.js')),
    tryImport(c('js/learnerNoteFilter.js')),
  ]);
  const prompt = (id) => {
    const p = c(`prompts/${id}.md`);
    return existsSync(p) ? readFileSync(p, 'utf8') : null;
  };
  /**
   * An agent's system prompt as that version assembles it. `kb` and
   * `catalog` are the eval's fixtures; `language` a language name or ''.
   */
  const system = (id, { kb = '', catalog = '', addendum = '', language: lang = '' } = {}) => {
    const text = prompt(id);
    if (text == null) return null;
    const directive = lang && language.languageDirective ? language.languageDirective(lang) : '';
    const kbNote = id === 'coach' ? assembly.COACH_KB_NOTE || '' : '';
    if (assembly.assembleSystemPrompt) return assembly.assembleSystemPrompt({ prompt: text, kb, kbNote, catalog, addendum, languageDirective: directive });
    return [text, kb && `\n\n---\n\n## Program Knowledge Base\n\n${kb}`, catalog && `\n\n---\n\n## Lessons in This Classroom\n\n${catalog}`, addendum && `\n\n---\n\n${addendum}`, directive].filter(Boolean).join('');
  };
  return { root, engine, assessment, orchestrator, assembly, language, validators, work, creation, markdown, notes, prompt, system };
}
