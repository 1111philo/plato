/**
 * Seed default content (prompts, courses, knowledge base) into the database.
 * Reads MD files from client/ at runtime. Called during first-time setup.
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import db from './db.js';
import { hashContent } from './content-updates.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Lambda build: content copied to server/client-content/; local dev: ../../client relative to server/
const clientDir = existsSync(join(__dirname, '../../client-content/prompts'))
  ? join(__dirname, '../../client-content')
  : join(__dirname, '../../../client');

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
      if (!existing) {
        await db.putSyncData('_system', `prompt:${name}`, { content, updatedBy: 'setup', bundledHash: hashContent(content) }, 0);
        seeded++;
      }
    }
  }

  // Seed courses
  const coursesDir = join(clientDir, 'data/courses');
  if (existsSync(coursesDir)) {
    const courseFiles = readdirSync(coursesDir).filter(f => f.endsWith('.md'));
    for (const file of courseFiles) {
      const courseId = file.replace(/\.md$/, '');
      const markdown = readFileSync(join(coursesDir, file), 'utf-8');
      const existing = await db.getSyncData('_system', `course:${courseId}`);
      if (!existing) {
        await db.putSyncData('_system', `course:${courseId}`, {
          markdown, name: courseId, isBuiltIn: true, updatedBy: 'setup',
          createdAt: new Date().toISOString(), bundledHash: hashContent(markdown),
        }, 0);
        seeded++;
      }
    }
  }

  // Seed knowledge base
  const kbPath = join(clientDir, 'data/knowledge-base.md');
  if (existsSync(kbPath)) {
    const existing = await db.getSyncData('_system', 'knowledgeBase');
    if (!existing) {
      const content = readFileSync(kbPath, 'utf-8');
      await db.putSyncData('_system', 'knowledgeBase', { content, updatedBy: 'setup', bundledHash: hashContent(content) }, 0);
      seeded++;
    }
  }

  // Seed default classroom branding (logo, colors)
  const existing = await db.getSyncData('_system', 'settings');
  if (!existing?.data?.logoBase64) {
    const logoPath = join(clientDir, 'assets/academy-logo.png');
    if (existsSync(logoPath)) {
      const logoData = readFileSync(logoPath);
      const logoBase64 = `data:image/png;base64,${logoData.toString('base64')}`;
      const settings = existing?.data || {};
      settings.logoBase64 = logoBase64;
      settings.logoAlt = "Plato's Academy";
      settings.theme = { primary: '#8b1a1a', accent: '#dc2626' };
      await db.putSyncData('_system', 'settings', settings, existing?.version || 0);
      seeded++;
    }
  }

  return seeded;
}
