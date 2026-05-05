# PR 144 OpenRouter Rewards Complete Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix every confirmed PR #144 review finding and make the relevant OpenRouter Rewards plugin tests part of the normal verification gate.

**Architecture:** Keep the fixes inside the existing plugin contract. The OpenRouter plugin should own cleanup for its `userMeta:openrouter-rewards` records through `onUninstall`, the learner completion slot should render reward errors as first-class UI state, and root verification should execute plugin-local tests so these paths cannot regress silently.

**Tech Stack:** React 19 + Vite client, Node.js built-in test runner, Hono server routes, plato plugin SDK, DynamoDB/sync-data-backed `userMeta:<pluginId>` records.

---

## Findings Covered

- [P1] OpenRouter Rewards stores per-user `userMeta:openrouter-rewards` but does not implement `onUninstall`, so the admin "Delete plugin data" flow clears activation/settings while leaving plugin-owned learner metadata behind.
- [P2] `LearnerCompletionAfter` records `/check-pending` errors but returns `null` before the error block can render, so reward failures after lesson completion silently disappear.
- [P2] Plugin-local tests live under `plugins/**` and are not executed by the current root `npm test` gate, so the new plugin runtime tests are easy to miss locally and in CI.
- [Merge blocker] GitHub's required `review` check fails before code review at the Bedrock OIDC credential step. This is infrastructure, not application code, but it blocks merge under the current ruleset.

## File Structure

- Modify `package.json`
  - Add a root `test:plugins` script that runs every `plugins/**/*.test.js`.
  - Include `test:plugins` in the root `test` script after client and server tests.
- Modify `plugins/openrouter-rewards/server/index.test.js`
  - Extend the fake sync store with `deleteSyncData`.
  - Preserve and restore `db.listAllUsers` and `db.deleteSyncData`.
  - Add a regression test proving `onUninstall` removes only OpenRouter Rewards user metadata.
- Modify `plugins/openrouter-rewards/server/index.js`
  - Import `getUserMeta` and `deleteUserMeta` from the plugin SDK.
  - Add `onUninstall(ctx)` to the default export.
- Create `plugins/openrouter-rewards/client/reward-card-state.js`
  - Pure UI state helper for deciding whether the completion reward card should render.
- Create `plugins/openrouter-rewards/client/reward-card-state.test.js`
  - Unit coverage for rendering errors, hiding no-claim, and rendering active reward results.
- Modify `plugins/openrouter-rewards/client/LearnerCompletionAfter.jsx`
  - Use the helper so errors render even when `result` is absent.
- No code file for the GitHub `review` check unless the repository owner chooses to manage workflow secrets/trust policy in code elsewhere. The required action is external configuration verification and workflow rerun.

---

## Task 1: Add Plugin Tests To The Normal Gate

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Confirm current root test gate omits plugin tests**

Run:

```bash
npm test
```

Expected before this task: output includes `client/tests/*.test.js` and `server/tests/**/*.test.js`, but does not include plugin test names such as `OpenRouter rewards routes`, `OpenRouter reward state machine`, or `Slack OpenRouter key delivery`.

- [ ] **Step 2: Add a plugin test script**

Modify `package.json` scripts to:

```json
{
  "scripts": {
    "build:client": "cd client && npm run build",
    "build:server": "cd server && sam build",
    "build": "npm run build:client && npm run build:server",
    "dev:client": "cd client && npm run dev",
    "dev:server": "cd server && npm run dev:sqlite",
    "test:client": "cd client && npm test",
    "test:server": "cd server && npm test",
    "test:plugins": "node --test $(find plugins -name '*.test.js' | sort)",
    "test": "npm run test:client && npm run test:server && npm run test:plugins",
    "deploy": "npm run build && cd server && sam deploy"
  }
}
```

- [ ] **Step 3: Run plugin tests directly**

Run:

```bash
npm run test:plugins
```

Expected: Node test output includes and passes:

```text
OpenRouter rewards routes
OpenRouter reward state machine
OpenRouter reward rules
OpenRouter API client
OpenRouter reward rule helpers
Slack OpenRouter key delivery
```

- [ ] **Step 4: Run the full root gate**

Run:

```bash
npm test
```

Expected: client tests, server tests, and plugin tests all pass in the same command.

- [ ] **Step 5: Commit the test gate change**

Run:

```bash
git add package.json
git commit -m "test: include plugin tests in root gate"
```

---

## Task 2: Add OpenRouter Rewards Uninstall Cleanup

**Files:**
- Modify: `plugins/openrouter-rewards/server/index.test.js`
- Modify: `plugins/openrouter-rewards/server/index.js`

- [ ] **Step 1: Extend the fake sync store for deletion**

In `plugins/openrouter-rewards/server/index.test.js`, update `fakeSyncStore()` so its returned object includes:

```js
deleteSyncData: async (userId, dataKey) => {
  store.delete(key(userId, dataKey));
  return { ok: true };
},
```

- [ ] **Step 2: Preserve and restore the DB methods needed by uninstall**

In the `beforeEach` `realDb` snapshot, add:

```js
listAllUsers: db.listAllUsers,
deleteSyncData: db.deleteSyncData,
```

After `db.getAllSyncData = store.getAllSyncData;`, add:

```js
db.deleteSyncData = store.deleteSyncData;
db.listAllUsers = async () => [
  { userId: 'usr_user' },
  { userId: 'usr_other' },
  { userId: 'usr_empty' },
];
```

In `afterEach`, restore:

```js
db.listAllUsers = realDb.listAllUsers;
db.deleteSyncData = realDb.deleteSyncData;
```

- [ ] **Step 3: Write the failing uninstall regression test**

Add this test near the end of `describe('OpenRouter rewards routes', ...)`:

```js
it('onUninstall deletes every OpenRouter rewards userMeta record only', async () => {
  store.set('usr_user', `userMeta:${PLUGIN_ID}`, { ...emptyState(), keyHash: 'hash_1' });
  store.set('usr_other', `userMeta:${PLUGIN_ID}`, { ...emptyState(), keyHash: 'hash_2' });
  store.set('usr_other', 'userMeta:teacher-comments', { comments: [{ id: 'cm_1' }] });

  const logs = [];
  await openRouterPlugin.onUninstall({
    logger: { info: (code, meta) => logs.push({ code, meta }) },
  });

  assert.equal(store.read('usr_user', `userMeta:${PLUGIN_ID}`), undefined);
  assert.equal(store.read('usr_other', `userMeta:${PLUGIN_ID}`), undefined);
  assert.deepEqual(store.read('usr_other', 'userMeta:teacher-comments'), { comments: [{ id: 'cm_1' }] });
  assert.deepEqual(logs, [{ code: 'data_uninstalled', meta: { recordsRemoved: 2 } }]);
});
```

- [ ] **Step 4: Run the focused test and verify it fails**

Run:

```bash
node --test plugins/openrouter-rewards/server/index.test.js
```

Expected before implementation:

```text
TypeError: openRouterPlugin.onUninstall is not a function
```

- [ ] **Step 5: Implement `onUninstall`**

In `plugins/openrouter-rewards/server/index.js`, extend the SDK import:

```js
  getUserMeta,
  deleteUserMeta,
```

Replace the default export at the end of the file with:

```js
export default {
  routes: createRoutes(),
  async onUninstall(ctx) {
    const users = await db.listAllUsers();
    let deleted = 0;
    for (const user of users) {
      const existing = await getUserMeta(user.userId, PLUGIN_ID);
      if (!existing) continue;
      await deleteUserMeta(user.userId, PLUGIN_ID);
      deleted += 1;
    }
    ctx.logger.info('data_uninstalled', { recordsRemoved: deleted });
  },
};
```

- [ ] **Step 6: Run the focused test and verify it passes**

Run:

```bash
node --test plugins/openrouter-rewards/server/index.test.js
```

Expected:

```text
# pass
# fail 0
```

- [ ] **Step 7: Run the plugin gate**

Run:

```bash
npm run test:plugins
```

Expected: every plugin test passes, including the new uninstall test.

- [ ] **Step 8: Commit the uninstall cleanup**

Run:

```bash
git add plugins/openrouter-rewards/server/index.js plugins/openrouter-rewards/server/index.test.js
git commit -m "fix: clean OpenRouter rewards data on uninstall"
```

---

## Task 3: Render Completion Reward Errors

**Files:**
- Create: `plugins/openrouter-rewards/client/reward-card-state.js`
- Create: `plugins/openrouter-rewards/client/reward-card-state.test.js`
- Modify: `plugins/openrouter-rewards/client/LearnerCompletionAfter.jsx`

- [ ] **Step 1: Create the failing helper test**

Create `plugins/openrouter-rewards/client/reward-card-state.test.js`:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shouldRenderCompletionRewardCard } from './reward-card-state.js';

describe('completion reward card state', () => {
  it('renders when a reward error exists without a result', () => {
    assert.equal(shouldRenderCompletionRewardCard({ result: null, error: 'Reward request failed' }), true);
  });

  it('hides when there is no result and no error', () => {
    assert.equal(shouldRenderCompletionRewardCard({ result: null, error: '' }), false);
  });

  it('hides no-claim results without an error', () => {
    assert.equal(shouldRenderCompletionRewardCard({ result: { status: 'no-claim' }, error: '' }), false);
  });

  it('renders no-claim results when an error is also present', () => {
    assert.equal(shouldRenderCompletionRewardCard({ result: { status: 'no-claim' }, error: 'Retry failed' }), true);
  });

  it('renders active reward results', () => {
    assert.equal(shouldRenderCompletionRewardCard({ result: { status: 'minted' }, error: '' }), true);
    assert.equal(shouldRenderCompletionRewardCard({ result: { status: 'processing' }, error: '' }), true);
    assert.equal(shouldRenderCompletionRewardCard({ result: { status: 'topped-up' }, error: '' }), true);
  });
});
```

- [ ] **Step 2: Run the focused helper test and verify it fails**

Run:

```bash
node --test plugins/openrouter-rewards/client/reward-card-state.test.js
```

Expected before implementation:

```text
Error [ERR_MODULE_NOT_FOUND]
```

- [ ] **Step 3: Add the pure helper**

Create `plugins/openrouter-rewards/client/reward-card-state.js`:

```js
export function shouldRenderCompletionRewardCard({ result, error }) {
  if (error) return true;
  return Boolean(result && result.status !== 'no-claim');
}
```

- [ ] **Step 4: Run the focused helper test and verify it passes**

Run:

```bash
node --test plugins/openrouter-rewards/client/reward-card-state.test.js
```

Expected:

```text
# pass
# fail 0
```

- [ ] **Step 5: Use the helper in `LearnerCompletionAfter`**

Modify `plugins/openrouter-rewards/client/LearnerCompletionAfter.jsx`:

```js
import { shouldRenderCompletionRewardCard } from './reward-card-state.js';
```

Replace:

```js
  if (!result || result.status === 'no-claim') return null;
```

With:

```js
  if (!shouldRenderCompletionRewardCard({ result, error })) return null;
```

Keep the existing error paragraph:

```jsx
{error && <p className="text-sm text-destructive" role="alert">{error}</p>}
```

- [ ] **Step 6: Run the plugin gate**

Run:

```bash
npm run test:plugins
```

Expected: plugin tests pass, including `completion reward card state`.

- [ ] **Step 7: Run the client production build**

Run:

```bash
npm run build:client
```

Expected: Vite build completes successfully and emits `dist/assets/index-*.css` and `dist/assets/index-*.js`.

- [ ] **Step 8: Commit the completion error rendering fix**

Run:

```bash
git add plugins/openrouter-rewards/client/LearnerCompletionAfter.jsx plugins/openrouter-rewards/client/reward-card-state.js plugins/openrouter-rewards/client/reward-card-state.test.js
git commit -m "fix: show OpenRouter completion reward errors"
```

---

## Task 4: Verify Merge-Blocking GitHub Review Check

**Files:**
- No repository file changes are required for the currently observed failure unless the workflow secret or AWS trust configuration is intentionally tracked in another private infrastructure repo.

- [ ] **Step 1: Re-check the current PR checks**

Run:

```bash
gh pr checks 144 --repo 1111philo/plato --watch=false
```

Expected before infrastructure repair:

```text
review fail
lint (client) pass
lint (server) pass
```

- [ ] **Step 2: Confirm the exact failure remains OIDC credential loading**

Run:

```bash
gh run view 25407033086 --repo 1111philo/plato --log-failed
```

Expected failure text:

```text
Configure AWS credentials (Bedrock OIDC)
Credentials could not be loaded, please check your action inputs: Could not load credentials from any providers
```

- [ ] **Step 3: Repair the GitHub/AWS configuration**

In the GitHub repository settings for `1111philo/plato`, verify that the `AWS_BEDROCK_ROLE_ARN` secret exists and is non-empty. In AWS account `722741357267`, verify role `plato-github-bedrock` allows the repository and PR workflow context to assume it through GitHub OIDC. The trust relationship must allow the Code Review workflow's branch or pull request ref for `1111philo/plato`.

Concrete checks for the maintainer with AWS access:

```bash
aws iam get-role --role-name plato-github-bedrock --query 'Role.AssumeRolePolicyDocument'
aws bedrock list-inference-profiles --region us-east-2
```

Expected: the trust policy includes GitHub's OIDC provider and a `sub` condition matching this repo/workflow context, and Bedrock inference profile access is available in the configured account/regions used by the workflow.

- [ ] **Step 4: Rerun the failed review workflow**

Run:

```bash
gh run rerun 25407033086 --repo 1111philo/plato --failed
```

Then watch:

```bash
gh pr checks 144 --repo 1111philo/plato --watch --interval 10
```

Expected after infrastructure repair:

```text
review pass
lint (client) pass
lint (server) pass
```

- [ ] **Step 5: If the secret/trust policy cannot be repaired immediately, document maintainer bypass**

Add a PR comment with the exact check state:

```bash
gh pr comment 144 --repo 1111philo/plato --body "Code checks pass locally and GitHub lint passes. Required review check is blocked before code review at Bedrock OIDC credential loading: \`Could not load credentials from any providers\`. This requires repository secret/trust-policy repair or maintainer ruleset bypass."
```

Expected: the PR has a durable audit trail explaining why the remaining blocker is infrastructure and not application code.

---

## Task 5: Final Verification And Push

**Files:**
- No new source files beyond Tasks 1-3.

- [ ] **Step 1: Verify the worktree is scoped**

Run:

```bash
git status --short --branch
```

Expected: only intentional commits from this plan are present; no unstaged source changes remain.

- [ ] **Step 2: Run whitespace validation**

Run:

```bash
git diff --check origin/main...HEAD
```

Expected: no output and exit code 0.

- [ ] **Step 3: Run all tests**

Run:

```bash
npm test
```

Expected:

```text
client tests pass
server tests pass
plugin tests pass
```

- [ ] **Step 4: Run production client build**

Run:

```bash
npm run build:client
```

Expected:

```text
✓ built
```

- [ ] **Step 5: Confirm plugin Tailwind classes still ship**

Run:

```bash
grep -o "wrap-anywhere\\|cursor-pointer\\|text-green-700" client/dist/assets/index-*.css | sort -u
```

Expected:

```text
cursor-pointer
text-green-700
wrap-anywhere
```

- [ ] **Step 6: Push the branch**

Run:

```bash
git push henry-fork feat/openrouter-rewards-plugin
```

Expected: PR #144 updates to the new head commit.

- [ ] **Step 7: Re-check PR state**

Run:

```bash
gh pr view 144 --repo 1111philo/plato --json headRefOid,mergeStateStatus,reviewDecision,statusCheckRollup
gh pr checks 144 --repo 1111philo/plato --watch=false
```

Expected: lint checks pass. The `review` check either passes after infrastructure repair or remains the only blocker with the documented OIDC credential failure.

---

## Self-Review Checklist

- [ ] P1 uninstall finding is covered by Task 2 with a failing test, implementation, and plugin test gate.
- [ ] P2 completion reward error finding is covered by Task 3 with a pure helper test, component change, plugin test gate, and client build.
- [ ] Plugin test visibility is covered by Task 1 and verified again in Task 5 through root `npm test`.
- [ ] GitHub review check blocker is covered by Task 4 with exact `gh` commands, expected failure text, repair checks, rerun command, and fallback PR comment.
- [ ] No task changes lesson completion semantics, pacing directives, exchange cutoffs, or `_system:settings.*`.
- [ ] No task asks the OpenRouter plugin to read or write another plugin's settings or user metadata.
- [ ] No task mounts routes outside `/v1/plugins/openrouter-rewards/`.
