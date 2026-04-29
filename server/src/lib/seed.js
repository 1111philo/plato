/**
 * Seed default content (prompts, lessons, knowledge base) into the database.
 * Reads MD files from client/ at runtime. Called during first-time setup.
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import db from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Lambda build: content copied to server/client-content/; local dev: ../../client relative to server/
const clientDir = existsSync(join(__dirname, '../../client-content/prompts'))
  ? join(__dirname, '../../client-content')
  : join(__dirname, '../../../client');

// Plugin prompts: contributed by plugins/<id>/prompts/*.md. Same dual-path logic.
function findPluginsDir() {
  const candidates = [
    join(__dirname, '../../../plugins'),    // local dev
    join(__dirname, '../../plugins'),       // Lambda function root
  ];
  for (const path of candidates) {
    if (existsSync(path)) return path;
  }
  return null;
}

export async function seedDefaultContent() {
  let seeded = 0;

  // Seed prompts
  const promptsDir = join(clientDir, 'prompts');
  if (existsSync(promptsDir)) {
    const promptFiles = readdirSync(promptsDir).filter(f => f.endsWith('.md'));
    for (const file of promptFiles) {
      const name = file.replace(/\.md$/, '');
      const content = readFileSync(join(promptsDir, file), 'utf-8');
      const existing = await db.getSyncData('_system', `prompt:${name}`);
      if (!existing || existing.data.content !== content) {
        await db.putSyncData('_system', `prompt:${name}`, { content, updatedBy: 'setup' }, existing?.version || 0);
        seeded++;
      }
    }
  }

  // Seed plugin-contributed prompts. Stored under prompt:plugin:<id>:<name> so they
  // never collide with core prompts. Phase 3 plugins that contribute AI agents will
  // be the primary consumer; for Phase 1 this is a no-op (Slack ships no prompts).
  const pluginsDir = findPluginsDir();
  if (pluginsDir) {
    for (const pluginDirName of readdirSync(pluginsDir)) {
      const pluginRoot = join(pluginsDir, pluginDirName);
      // Skip stray files (e.g. README.md at the plugins/ root).
      try {
        if (!statSync(pluginRoot).isDirectory()) continue;
      } catch {
        continue;
      }
      const pluginPromptsDir = join(pluginRoot, 'prompts');
      if (!existsSync(pluginPromptsDir)) continue;
      const files = readdirSync(pluginPromptsDir).filter(f => f.endsWith('.md'));
      for (const file of files) {
        const name = file.replace(/\.md$/, '');
        const content = readFileSync(join(pluginPromptsDir, file), 'utf-8');
        const key = `prompt:plugin:${pluginDirName}:${name}`;
        const existing = await db.getSyncData('_system', key);
        if (!existing || existing.data.content !== content) {
          await db.putSyncData('_system', key, { content, updatedBy: `plugin:${pluginDirName}` }, existing?.version || 0);
          seeded++;
        }
      }
    }
  }

  // Seed lessons
  const lessonsDir = join(clientDir, 'data/lessons');
  if (existsSync(lessonsDir)) {
    const lessonFiles = readdirSync(lessonsDir).filter(f => f.endsWith('.md'));
    for (const file of lessonFiles) {
      const lessonId = file.replace(/\.md$/, '');
      const markdown = readFileSync(join(lessonsDir, file), 'utf-8');
      const existing = await db.getSyncData('_system', `lesson:${lessonId}`);
      if (!existing) {
        await db.putSyncData('_system', `lesson:${lessonId}`, {
          markdown, name: lessonId, isBuiltIn: true, updatedBy: 'setup',
          createdAt: new Date().toISOString(),
        }, 0);
        seeded++;
      }
    }
  }

  // Knowledge base is NOT seeded — admins create their own via the KB Editor agent

  // Seed default theme colors (no logo — admins set classroom name + optional logo in setup/customizer)
  const existing = await db.getSyncData('_system', 'settings');
  if (!existing?.data?.theme) {
    const settings = existing?.data || {};
    settings.theme = { primary: '#8b1a1a', accent: '#dc2626' };
    await db.putSyncData('_system', 'settings', settings, existing?.version || 0);
    seeded++;
  }

  return seeded;
}
