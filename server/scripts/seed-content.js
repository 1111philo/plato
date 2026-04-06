#!/usr/bin/env node
/**
 * Seed prompts, lessons, and knowledge base into the database.
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
    }, existing?.version || 0);
    console.log(`  prompt: ${name}`);
  }

  // Seed lessons
  const lessonsDir = join(clientDir, 'data/lessons');
  const lessonFiles = readdirSync(lessonsDir).filter(f => f.endsWith('.md'));
  for (const file of lessonFiles) {
    const lessonId = file.replace(/\.md$/, '');
    const markdown = readFileSync(join(lessonsDir, file), 'utf-8');
    const existing = await db.getSyncData('_system', `lesson:${lessonId}`);
    await db.putSyncData('_system', `lesson:${lessonId}`, {
      markdown,
      name: lessonId,
      isBuiltIn: true,
      updatedBy: 'seed-script',
      createdAt: existing?.data?.createdAt || new Date().toISOString(),
    }, existing?.version || 0);
    console.log(`  lesson: ${lessonId}`);
  }

  // Knowledge base is NOT seeded — admins create their own via the KB Editor agent

  console.log('Done!');
}

seed().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
