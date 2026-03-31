# Agent Lifecycle: Exemplar-Driven Learning Loop

This documents every agent invocation as a learner moves through a course -- the order, what data goes in, what comes out, and what validation runs.

For the agent table and architecture overview, see [Architecture](architecture.md).

---

## Phase 1: Course Start

When a learner starts a course, two things happen: the Course Owner initializes the knowledge base, then the Coach begins the conversation.

### 1. Course Owner Agent

| | |
|---|---|
| Prompt | [`course-owner.md`](../prompts/course-owner.md) |
| Model | `MODEL_LIGHT` |
| Trigger | Learner opens a course for the first time ([`courseEngine.startCourse`](../src/lib/courseEngine.js)) |
| Function | `orchestrator.initializeCourseKB()` |
| Validation | `validateCourseKB()` in [`validators.js`](../js/validators.js) |

**Input:**
- `courseId`, `courseName`, `courseDescription`
- `exemplar` -- from the course prompt markdown file
- `learningObjectives[]` -- from the course prompt
- `learnerProfile` -- summary string (or "New learner, no profile yet.")

**Output:**
```json
{
  "exemplar": "Full exemplar description",
  "objectives": [
    { "objective": "Can identify interests...", "evidence": "What demonstrates this objective" }
  ],
  "learnerPosition": "New learner beginning the course",
  "insights": [],
  "activitiesCompleted": 0,
  "status": "active"
}
```

The course KB is saved to the `course_kbs` table and synced as `courseKB:{courseId}`.

### 2. Coach (course start)

| | |
|---|---|
| Prompt | [`coach.md`](../prompts/coach.md) |
| Model | `MODEL_LIGHT` |
| Trigger | Fires immediately after Course Owner |
| Function | `orchestrator.converseStream('coach', messages)` |

The Coach welcomes the learner and begins the learning conversation. Its system prompt includes the program knowledge base (`data/knowledge-base.md`) and the full course KB context (exemplar, objectives, learner position). The response is streamed token by token.

---

## Phase 2: Learning Conversation

The core of the experience is a continuous conversation with the Coach. The Coach handles everything in a single turn: coaching, creating activities, and assessing submissions. There is no separate activity-creation or assessment step -- it all happens inline.

### 3. Coach (every response)

| | |
|---|---|
| Prompt | [`coach.md`](../prompts/coach.md) |
| Model | `MODEL_LIGHT` |
| Trigger | Learner sends a message, submits work, or uploads an image |
| Function | `orchestrator.converseStream('coach', messages)` |

**Input:** The full conversation history plus course KB context (exemplar, objectives, learner position, insights, activities completed).

**Output:** Plain text response (streamed), potentially containing structured signals:

- **`[PROGRESS: N]`** (0-10) -- tracks how close the learner is to achieving the exemplar
- **`[KB_UPDATE]`** -- JSON payload with new insights and updated learner position, merged into the course KB
- **`[PROFILE_UPDATE]`** -- JSON payload with profile updates (strengths, observations)

These signals are stripped from the displayed response and processed by `courseEngine.js`:

1. **`[KB_UPDATE]`** -- insights are appended to the course KB, learner position is updated, activity count is incremented via `updateCourseKBFromAssessment()` in [`courseOwner.js`](../js/courseOwner.js)
2. **`[PROFILE_UPDATE]`** -- profile is updated via the profile queue in [`profileQueue.js`](../src/lib/profileQueue.js)
3. **`[PROGRESS: 10]`** -- when progress reaches 10, the learner has achieved the exemplar and the course moves to completion

Because the Coach reads the enriched KB on every turn, its coaching and activities become more precisely tuned as the conversation progresses.

---

## Phase 3: Course Completion

When the Coach signals `[PROGRESS: 10]`, the learner has demonstrated the exemplar.

### 4. Coach (course complete)

The Coach's final response celebrates the learner's achievement. The course status is set to `"completed"` in the course KB.

### 5. Learner Profile Owner -- Deep Update (LLM)

| | |
|---|---|
| Prompt | [`learner-profile-owner.md`](../prompts/learner-profile-owner.md) |
| Model | `MODEL_LIGHT` |
| Trigger | Course completed (progress reaches 10) |
| Function | `orchestrator.updateProfileOnCompletion()` via `profileQueue.updateProfileOnCompletionInBackground()` |

**Input:** `currentProfile`, `courseKB` (full enriched KB), `courseName`, `courseId`, `activitiesCompleted`

**Output:** `{ profile, summary }` -- comprehensive profile update reflecting all skills demonstrated throughout the course. Adds courseId to `masteredCourses`, updates strengths/weaknesses based on the full course KB.

---

## Ad-hoc: Profile Feedback

| | |
|---|---|
| Prompt | [`learner-profile-update.md`](../prompts/learner-profile-update.md) |
| Model | `MODEL_LIGHT` |
| Trigger | Learner submits feedback in Settings |
| Function | `orchestrator.updateProfileFromFeedback()` via `profileQueue.updateProfileFromFeedbackInBackground()` |

**Input:** `currentProfile`, `learnerFeedback` text, `context` (courseName, activityType, activityGoal)

**Output:** `{ profile, summary }` -- updated profile incorporating the feedback.

---

## Data flow summary

```
Course Prompt (.md)
       │
  Course Owner ──→ Course KB (initialized)
       │                 │
     Coach ←─────────────┤ (reads enriched KB)
       │                 │
  Coaches, creates       │
  activities, assesses   │
  — all in one turn      │
       │                 │
  [KB_UPDATE] ───────────┤ (writes insights back)
  [PROFILE_UPDATE]       │
  [PROGRESS: 0-10]       │
       │                 │
  ┌────┴─────┐           │
  │          │           │
 < 10       = 10         │
  │          │           │
 Next turn  Coach celebrates
 (enriched  Profile deep update (LLM)
  KB)       Course complete
```
