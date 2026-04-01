#!/usr/bin/env node
/**
 * Seed prompts, courses, and knowledge base into the database.
 * Reads MD files from client/ and inserts as _system sync data.
 *
 * Usage:
 *   DB_BACKEND=sqlite SQLITE_PATH=./data/plato-dev.db node scripts/seed-content.js
 *   # or with DynamoDB:
 *   DYNAMODB_ENDPOINT=http://localhost:8000 node scripts/seed-content.js
 */

import { readFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const clientDir = resolve(__dirname, '../../client');

// Dynamic import to pick up env-driven backend
const { default: db } = await import('../src/lib/db.js');
const { hashContent } = await import('../src/lib/content-updates.js');

async function seed() {
  console.log('Seeding content...');

  // Seed prompts
  const promptsDir = join(clientDir, 'prompts');
  const promptFiles = readdirSync(promptsDir).filter(f => f.endsWith('.md'));
  for (const file of promptFiles) {
    const name = file.replace(/\.md$/, '');
    const content = readFileSync(join(promptsDir, file), 'utf-8');
    const existing = await db.getSyncData('_system', `prompt:${name}`);
    await db.putSyncData('_system', `prompt:${name}`, {
      content,
      updatedBy: 'seed-script',
      bundledHash: hashContent(content),
    }, existing?.version || 0);
    console.log(`  prompt: ${name}`);
  }

  // Seed courses
  const coursesDir = join(clientDir, 'data/courses');
  const courseFiles = readdirSync(coursesDir).filter(f => f.endsWith('.md'));
  for (const file of courseFiles) {
    const courseId = file.replace(/\.md$/, '');
    const markdown = readFileSync(join(coursesDir, file), 'utf-8');
    const existing = await db.getSyncData('_system', `course:${courseId}`);
    await db.putSyncData('_system', `course:${courseId}`, {
      markdown,
      name: courseId,
      isBuiltIn: true,
      updatedBy: 'seed-script',
      createdAt: existing?.data?.createdAt || new Date().toISOString(),
      bundledHash: hashContent(markdown),
    }, existing?.version || 0);
    console.log(`  course: ${courseId}`);
  }

  // Seed knowledge base
  const kbPath = join(clientDir, 'data/knowledge-base.md');
  const kbContent = readFileSync(kbPath, 'utf-8');
  const existingKb = await db.getSyncData('_system', 'knowledgeBase');
  await db.putSyncData('_system', 'knowledgeBase', {
    content: kbContent,
    updatedBy: 'seed-script',
    bundledHash: hashContent(kbContent),
  }, existingKb?.version || 0);
  console.log('  knowledge base');

  console.log('Done!');
}

seed().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
