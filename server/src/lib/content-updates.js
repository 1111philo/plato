/**
 * Content change management — detect when bundled content files
 * differ from what's stored in the database, so admins can review
 * and accept upstream updates.
 */

import { createHash } from 'crypto';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import db from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Lambda build: content copied to server/client-content/; local dev: ../../client relative to server/
const clientDir = existsSync(join(__dirname, '../../client-content/prompts'))
  ? join(__dirname, '../../client-content')
  : join(__dirname, '../../../client');

export function hashContent(content) {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

/**
 * Read all bundled content files from disk.
 * Returns [{ type, name, dataKey, content, hash }]
 */
export function readBundledContent() {
  const items = [];

  // Prompts
  const promptsDir = join(clientDir, 'prompts');
  if (existsSync(promptsDir)) {
    for (const file of readdirSync(promptsDir).filter(f => f.endsWith('.md'))) {
      const name = file.replace(/\.md$/, '');
      const content = readFileSync(join(promptsDir, file), 'utf-8');
      items.push({ type: 'prompt', name, dataKey: `prompt:${name}`, content, hash: hashContent(content) });
    }
  }

  // Courses
  const coursesDir = join(clientDir, 'data/courses');
  if (existsSync(coursesDir)) {
    for (const file of readdirSync(coursesDir).filter(f => f.endsWith('.md'))) {
      const courseId = file.replace(/\.md$/, '');
      const content = readFileSync(join(coursesDir, file), 'utf-8');
      items.push({ type: 'course', name: courseId, dataKey: `course:${courseId}`, content, hash: hashContent(content) });
    }
  }

  // Knowledge base
  const kbPath = join(clientDir, 'data/knowledge-base.md');
  if (existsSync(kbPath)) {
    const content = readFileSync(kbPath, 'utf-8');
    items.push({ type: 'knowledgeBase', name: 'knowledgeBase', dataKey: 'knowledgeBase', content, hash: hashContent(content) });
  }

  return items;
}

/**
 * Compare bundled files against DB records.
 * Returns pending updates where the bundled version differs.
 */
export async function getPendingUpdates() {
  const bundled = readBundledContent();
  const pending = [];

  for (const item of bundled) {
    const dbRecord = await db.getSyncData('_system', item.dataKey);

    if (!dbRecord) {
      // New file not yet in DB
      pending.push({
        type: item.type,
        name: item.name,
        dataKey: item.dataKey,
        currentContent: null,
        newContent: item.content,
        isNew: true,
      });
      continue;
    }

    const storedHash = dbRecord.data.bundledHash;
    if (storedHash === item.hash) continue; // Already accepted or matches seed

    // No bundledHash yet (pre-upgrade record) — compare DB content to bundled content
    if (!storedHash) {
      const dbContent = item.type === 'course' ? dbRecord.data.markdown : dbRecord.data.content;
      if (hashContent(dbContent || '') === item.hash) {
        // Content is identical — persist the hash so we don't re-check next time
        await db.putSyncData('_system', item.dataKey, {
          ...dbRecord.data,
          bundledHash: item.hash,
        }, dbRecord.version);
        continue;
      }
    }

    // Content differs — surface as pending update
    const currentContent = item.type === 'course' ? dbRecord.data.markdown : dbRecord.data.content;
    pending.push({
      type: item.type,
      name: item.name,
      dataKey: item.dataKey,
      currentContent: currentContent || '',
      newContent: item.content,
      isNew: false,
    });
  }

  return pending;
}
