/**
 * A dataset shaped exactly like what Beta-RC-232 (629c778) writes — the
 * release every production install runs at the start of the launch sprint.
 * Migrations must upgrade this without losing or corrupting anything, and
 * Beta-RC-232's own code must still read it afterwards.
 *
 * Deliberately awkward on purpose: one-word, multi-word, empty, and padded
 * names; a lesson pointing at a deleted course; drafts and privates; custom
 * lessons; wait-list rows; legacy `role: 'user'` everywhere.
 */

const LESSON_MD = (name) => `# ${name}

What this lesson covers.

## Exemplar

A short reflection.

## Learning Objectives

- Can name the key idea
- Can apply it to an example`;

export const FIXTURE = {
  users: [
    { userId: 'usr_admin', email: 'admin@example.com', username: 'admin', name: 'Admin', role: 'admin' },
    { userId: 'usr_ada', email: 'ada@example.com', username: 'ada', name: 'Ada Lovelace', role: 'user', userGroup: 'Cohort A', customFields: { fld_phone: '+1 312 555 0100' } },
    { userId: 'usr_cher', email: 'cher@example.com', username: 'cher', name: 'Cher', role: 'user' },
    { userId: 'usr_mae', email: 'mae@example.com', username: 'mae', name: 'Mary Ann Evans', role: 'user', userGroup: 'Cohort B' },
    { userId: 'usr_jose', email: 'jose@example.com', username: 'jose', name: 'José María García López', role: 'user' },
    { userId: 'usr_blank', email: 'blank@example.com', username: 'blank', name: '', role: 'user' },
    { userId: 'usr_pad', email: 'pad@example.com', username: 'pad', name: '  Padded   Name  ', role: 'user' },
  ],
  courses: [
    { id: 'course-found01', name: 'Foundations' },
    { id: 'course-lead001', name: 'AI Leadership' },
  ],
  lessons: [
    { id: 'les-f2', name: 'Foundations 2 - Values', course: 'course-found01', status: 'public' },
    { id: 'les-f1', name: 'Foundations 1 - Identity', course: 'course-found01', status: 'public' },
    { id: 'les-l1', name: 'AI Leadership 1', course: 'course-lead001', status: 'public' },
    { id: 'les-priv', name: 'Shared Private', course: 'course-lead001', status: 'private', sharedWith: ['usr_ada'] },
    { id: 'les-loose', name: 'Loose Lesson', course: null, status: 'public' },
    { id: 'les-orphan', name: 'Orphaned Course Ref', course: 'course-deleted', status: 'public' },
    { id: 'les-draft', name: 'Draft', course: null, status: 'draft', markdown: '' },
  ],
  settings: {
    classroomName: 'Test Classroom',
    userGroups: ['Cohort A', 'Cohort B'],
    userFields: [{ id: 'fld_phone', label: 'Phone Number', type: 'text', required: true }],
    theme: { primary: '#470d99', accent: '#dc2626' },
  },
  // Per-learner sync records: the data migrations must never rewrite.
  learnerData: {
    usr_ada: {
      preferences: { name: 'Ada' },
      profile: { name: 'Ada', strengths: ['writing'] },
      'lessonKB:les-f1': { lessonId: 'les-f1', status: 'completed', progress: 10, activitiesCompleted: 4, objectives: [{ objective: 'Can name the key idea', evidence: 'Names it' }], insights: ['Strong writer'] },
      'lessonKB:les-f2': { lessonId: 'les-f2', status: 'active', progress: 4, activitiesCompleted: 2, objectives: [], insights: [] },
      'messages:les-f1': [
        { role: 'assistant', content: 'Welcome!', msgType: 'guide', phase: 'qa', timestamp: 1 },
        { role: 'user', content: '[image]', msgType: 'user', phase: 'qa', metadata: { imageKeys: ['screenshot:lesson-les-f1-1-0'] }, timestamp: 2 },
      ],
      'screenshot:lesson-les-f1-1-0': { dataUrl: 'data:image/png;base64,AAAA' },
      'courseProgress:course-found01': { courseId: 'course-found01', summary: 'Named her values.', completedLessonIds: ['les-f1'], updatedAt: 3 },
      'lessons:custom-abc': { lessonId: 'custom-abc', markdown: LESSON_MD('My Custom Lesson'), createdAt: 4 },
    },
    usr_mae: {
      'lessonKB:les-l1': { lessonId: 'les-l1', status: 'active', progress: 2, activitiesCompleted: 1, objectives: [], insights: [] },
    },
  },
  invites: [
    { inviteToken: 'inv_pending1', email: 'new@example.com', invitedBy: 'usr_admin' },
  ],
  waitlist: [
    { inviteToken: 'inv_wl1', email: 'wait@example.com', profile: { name: 'Wait Listed', userGroup: 'Cohort A', customFields: { fld_phone: '555 0100 1234' } } },
  ],
};

/** Write the fixture through the db API, the way Beta-RC-232 would have. */
export async function seedRc232(db) {
  for (const u of FIXTURE.users) {
    await db.createUser({ ...u, passwordHash: '$2a$12$fixture' });
  }
  for (const c of FIXTURE.courses) {
    await db.putSyncData('_system', `course:${c.id}`, { name: c.name, createdBy: 'usr_admin', createdByName: 'admin', createdAt: '2026-06-01T00:00:00.000Z' }, 0);
  }
  for (const l of FIXTURE.lessons) {
    await db.putSyncData('_system', `lesson:${l.id}`, {
      markdown: l.markdown ?? LESSON_MD(l.name), name: l.name, isBuiltIn: false,
      status: l.status, sharedWith: l.sharedWith || [], course: l.course,
      createdBy: 'usr_admin', createdByName: 'admin', createdAt: '2026-06-01T00:00:00.000Z',
    }, 0);
  }
  await db.putSyncData('_system', 'settings', FIXTURE.settings, 0);
  await db.putSyncData('_system', 'waitlist', { open: true, apiKeyHash: null }, 0);
  await db.putSyncData('_system', 'prompt:coach', { content: '# coach', updatedBy: 'setup' }, 0);
  for (const [userId, records] of Object.entries(FIXTURE.learnerData)) {
    for (const [key, data] of Object.entries(records)) await db.putSyncData(userId, key, data, 0);
  }
  for (const inv of FIXTURE.invites) await db.createInvite(inv);
  for (const w of FIXTURE.waitlist) await db.createWaitlistEntry(w);
}

/**
 * Every record, as `{ [stableKey]: jsonString }` — compare two snapshots to
 * see exactly what a migration touched. Volatile fields (updatedAt/version on
 * sync rows we don't expect to change) are kept: an untouched record must be
 * byte-identical, including its version.
 */
export async function snapshot(db) {
  const out = {};
  const users = await db.listAllUsers();
  for (const u of users) out[`user:${u.userId}`] = JSON.stringify(u);
  for (const inv of await db.listInvites()) out[`invite:${inv.inviteToken}`] = JSON.stringify(inv);
  const owners = ['_system', ...users.map((u) => u.userId)];
  for (const owner of owners) {
    for (const item of await db.getAllSyncData(owner)) {
      out[`sync:${owner}:${item.dataKey}`] = JSON.stringify(item);
    }
  }
  return out;
}

/** `{ added, removed, changed }` key lists between two snapshots. */
export function diffSnapshots(before, after) {
  const added = Object.keys(after).filter((k) => !(k in before));
  const removed = Object.keys(before).filter((k) => !(k in after));
  const changed = Object.keys(before).filter((k) => k in after && before[k] !== after[k]);
  return { added, removed, changed };
}
