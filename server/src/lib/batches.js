/**
 * Run `fn` over `items` a few at a time, concurrently (each batch waits for
 * the last). Returns how many items were left when `deadline` passed (0 when
 * all ran). Used by the learner-email jobs and admin bulk changes.
 */
export async function inBatches(items, fn, { size = 8, deadline = Infinity, clock = Date.now } = {}) {
  for (let i = 0; i < items.length; i += size) {
    if (clock() > deadline) return items.length - i;
    await Promise.all(items.slice(i, i + size).map(fn));
  }
  return 0;
}
