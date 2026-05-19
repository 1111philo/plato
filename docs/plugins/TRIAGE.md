# Plugin vs. Core — Triage Guide

This guide helps agents (pilot, issue-intake) and maintainers decide whether a feature request should be implemented as a **plugin** or a **core change**.

## Quick decision tree

```
Is the feature…
  ├─ Essential to the learner/coach/admin workflow? ────► CORE
  ├─ Optional, org-specific, or integrating with external systems? ────► PLUGIN
  ├─ Modifying completion logic, pacing, or lesson state? ────► CORE (plugins MUST NOT)
  └─ Unsure? ────► Read the detailed criteria below
```

## Core changes

**Core** is for functionality that:
- Every plato deployment needs to serve learners effectively
- Touches the coach-learner conversation, lesson completion, or learner profiles
- Modifies auth, sync-data schema, or DynamoDB structure
- Changes the lesson creation flow, Knowledge Base editor, or admin dashboard
- Affects how prompts are loaded, lessons are parsed, or AI agents are orchestrated

**Examples of core-appropriate requests:**
- "Lessons should support audio recordings" → touches coach context and lesson state
- "Add a 'pause lesson' button" → learner-facing, affects in-flight lesson state
- "Track time spent per lesson" → requires sync-data schema changes, affects learner profiles
- "Let admins preview lessons before sharing" → admin workflow, affects lesson visibility
- "Add keyboard shortcuts to the classroom" → universal learner UX improvement

## Plugin changes

**Plugins** are for functionality that:
- Is optional — some classrooms want it, others don't
- Integrates with external systems (Slack, email, analytics, LMS)
- Adds admin-facing tools or reports that don't change core lesson/coach behavior
- Extends the platform without modifying how lessons complete or how the coach responds

**Examples of plugin-appropriate requests:**
- "Send Slack notifications when a learner completes a lesson" → external integration, opt-in
- "Export learner progress to a CSV" → admin tool, doesn't change lesson behavior
- "Track lesson completions in Google Analytics" → external analytics, opt-in
- "Add a custom admin dashboard widget" → admin-facing, org-specific
- "Send an email reminder if a learner hasn't logged in for 7 days" → optional nudge behavior

## Anti-goals (never implement as a plugin)

Plugins **MUST NOT**:
- Modify `lessonKB.status` or override completion logic (only the coach owns this)
- Introduce hard exchange-count cutoffs or force-complete lessons
- Bypass capability checks by importing core modules directly
- Write to `_system:settings.*` or read/write another plugin's settings
- Modify files outside `plugins/<id>/` from inside a plugin

If a feature request requires any of the above, it's a **core change** (or should be rejected as violating plato's coaching philosophy).

## Edge cases

### "Add a new field to the learner profile"

- **Core** if the field is **always relevant** to coaching (e.g., "learning style preference" that the coach should always see).
- **Plugin** if the field is **org-specific** (e.g., "employee ID" for an HR system integration). Store in `userMeta:<pluginId>` instead.

### "Add a new admin report"

- **Core** if the report is about **lesson pacing, completion rates, or coach quality** (these are universal KPIs).
- **Plugin** if the report is about **external integrations** (e.g., "which learners have Slack accounts?") or org-specific metrics (e.g., "compliance training completion by department").

### "Add a new lesson type"

- **Core** — lesson types are structural to how plato works. Even if the lesson type is specialized (e.g., "coding challenge" with a code editor), it affects the coach context, lesson parsing, and learner UX.

### "Add a button to the classroom"

- **Core** if the button is **learner-facing and universal** (e.g., "reset my progress on this lesson").
- **Plugin** if the button is **admin-facing** (e.g., "export this lesson to PDF") and uses the `adminSettingsPanel` or `adminDashboard` slot.

## When in doubt

Ask:
1. **Would every plato deployment benefit from this?** → Core
2. **Is this optional or org-specific?** → Plugin
3. **Does this touch lesson completion, coach behavior, or learner profiles?** → Core (unless it's purely additive data storage in `userMeta`)

If still unsure, default to **core** and let the maintainer redirect. A misclassified plugin request is easier to convert to core than the reverse.

## For pilot and issue-intake agents

When triaging a `ready-for-pilot` issue:
1. Read the issue body to understand what the user wants.
2. Apply the decision tree above.
3. If the issue is **plugin-appropriate**:
   - Check if the required extension points exist via `docs/plugins/EXTENSION_REFERENCE.md` or the `/v1/plugins/extension-points` API.
   - If the extension points exist, implement the plugin.
   - If the extension points **do not exist**, label the issue `extension-point` and **SKIP** (maintainer judgment required).
4. If the issue is **core-appropriate**, proceed with a core fix.
5. If the issue violates an anti-goal (forced closures, hard cutoffs, etc.), **SKIP** with a comment explaining why the request conflicts with plato's philosophy.

## For maintainers

When reviewing a pilot PR:
- If the PR implements a plugin for something that should be core, close it and comment: "This should be a core change because [reason]. I'll handle it separately."
- If the PR implements a core change for something that should be a plugin, close it and comment: "This is plugin territory. See `docs/plugins/TRIAGE.md` for guidance."
- If you disagree with the triage but the implementation is solid, **merge it anyway** and file a follow-up issue to refactor. Don't let perfect be the enemy of good.
