/**
 * Link plato accounts to Slack: Admin → Users → select users → Update… →
 * "Slack link". Each selected account is matched to a workspace member by
 * email and gets `user.slackUserId` (the "Slack linked" mark). An existing
 * link is never changed, and nobody is added to a channel.
 */

/**
 * Pure: decide which users to link. `members` is the workspace list
 * (`{ slackUserId, email }`). Returns `{ toLink: [{ userId, slackUserId }],
 * alreadyLinked, notInWorkspace }`.
 */
export function planLinks(users, members) {
  const byEmail = new Map();
  for (const m of members) if (m.email) byEmail.set(m.email.toLowerCase(), m.slackUserId);
  const plan = { toLink: [], alreadyLinked: 0, notInWorkspace: 0 };
  for (const u of users) {
    if (u.slackUserId) { plan.alreadyLinked++; continue; }
    const slackUserId = u.email && byEmail.get(u.email.toLowerCase());
    if (slackUserId) plan.toLink.push({ userId: u.userId, slackUserId });
    else plan.notInWorkspace++;
  }
  return plan;
}

/**
 * Apply a plan, 10 writes at a time. Returns `{ linked, alreadyLinked,
 * notInWorkspace, failed }`.
 */
export async function linkAccounts(users, members, link, { concurrency = 10 } = {}) {
  const plan = planLinks(users, members);
  const result = { linked: 0, alreadyLinked: plan.alreadyLinked, notInWorkspace: plan.notInWorkspace, failed: 0 };
  for (let i = 0; i < plan.toLink.length; i += concurrency) {
    await Promise.all(plan.toLink.slice(i, i + concurrency).map(({ userId, slackUserId }) =>
      link(userId, slackUserId).then(() => { result.linked++; }, () => { result.failed++; })));
  }
  return result;
}
