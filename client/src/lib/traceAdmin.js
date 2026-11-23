// Admin → Users wording for Trace mode (#595): the bulk-update dialog's
// sentence and button, and the message after it runs. Pure, tested in
// client/tests/traceAdmin.test.js. Trace mode is an account setting, so
// wait-list entries are never sent.
const users = (n) => `${n} ${n === 1 ? 'user' : 'users'}`;
const people = (n) => `${n} ${n === 1 ? 'person' : 'people'}`;

/** What Apply will do, shown under the On / Off radios. */
export function traceBulkSentence({ on, users: count, waitlist = 0 }) {
  const what = on
    ? `Records what plato does in the lessons of ${users(count)}. They’re told, and can read the trace too.`
    : `Turns Trace mode off for ${users(count)}. Anyone who turned it on themselves keeps it.`;
  return `${what}${waitlist ? ' Wait-list entries are skipped.' : ''}`;
}

export const traceBulkButton = ({ on, users: count }) => `Turn ${on ? 'on' : 'off'} for ${users(count)}`;

/** `result` is POST /v1/admin/users/bulk-update's `{ updated, unchanged, failed: [] }`. */
export function traceBulkResult(result, on) {
  const state = on ? 'on' : 'off';
  const failed = result.failed?.length || 0;
  const parts = [`Trace mode turned ${state} for ${people(result.updated || 0)}.`];
  if (result.unchanged) parts.push(`${result.unchanged} already had it ${state}.`);
  if (failed) parts.push(`${failed} couldn’t be updated.`);
  return { text: parts.join(' '), type: failed ? 'error' : 'success' };
}
