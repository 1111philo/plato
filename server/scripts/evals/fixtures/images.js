/**
 * Screenshot fixtures (fixtures/images/*.png): small synthetic pages for the
 * cases where the evidence is an image (A13, the simulated learners' L6, L9,
 * L12 and L13 screenshots). Rendered once with Playwright; no learner data.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'images');

/** A fixture as the data URL a pasted screenshot arrives as. */
export const image = (name) => `data:image/png;base64,${readFileSync(join(dir, name)).toString('base64')}`;

/** The screenshot each lesson asks for. */
export const LESSON_IMAGE = { L6: 'checklist.png', L9: 'setup.png', L12: 'community-post.png', L13: 'featured.png' };

/** An image as a content part, as lessonEngine.buildUserParts writes it. */
export function imagePart(name) {
  return { type: 'image', source: { type: 'base64', media_type: 'image/png', data: readFileSync(join(dir, name)).toString('base64') } };
}
