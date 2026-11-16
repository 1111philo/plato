// Admin → Users → User Groups: how many are in each group. Pure, tested in
// client/tests/groupCounts.test.js. Items are AdminUsers' combinedList
// wrappers (`_type` 'user' | 'invite' | 'waitlist').
//
// `people` is signed-up users plus wait-list entries (what the dialog always
// counted). `invited` is pending invites made from the wait list, which keep
// the entry's group until signup copies it onto the account; they're shown
// apart so a big batch of invites doesn't read as people who signed up. An
// invite for an existing account isn't counted: that person's account row
// already is.

const people = (n) => `${n} ${n === 1 ? 'person' : 'people'}`;

/** `{ [group]: { people, invited } }` over `items`. */
export function countGroupMembers(items) {
  const counts = {};
  for (const i of items) {
    if (!i.userGroup) continue;
    if (i._type === 'invite' && i._invite?.existingAccount) continue;
    const c = counts[i.userGroup] || (counts[i.userGroup] = { people: 0, invited: 0 });
    if (i._type === 'invite') c.invited++; else c.people++;
  }
  return counts;
}

/** "40 people", or "40 people · 560 invited" when some are invited. */
export function describeGroupCount(count) {
  const { people: p = 0, invited = 0 } = count || {};
  return invited ? `${people(p)} · ${invited} invited` : people(p);
}

/** For the delete warning: "40 people", or "40 people and 560 invited people". */
export function describeGroupMembers(count) {
  const { people: p = 0, invited = 0 } = count || {};
  return invited ? `${people(p)} and ${invited} invited ${invited === 1 ? 'person' : 'people'}` : people(p);
}
