/**
 * Admin routes for notifications (#388, #389, #400), registered onto the admin
 * app, so they sit behind `authenticate` + `authorize` (notifications.read /
 * notifications.write). Logic lives in lib/notifications.js.
 */
import {
  TEMPLATES, readAutomations, writeAutomations, getTemplate, putTemplate, resetTemplate,
  validateTemplate, renderEmail, sendNotificationEmail,
} from '../lib/notifications.js';
import { getClassroom } from '../lib/email.js';
import { nameFields } from '../lib/names.js';
import { APP_URL } from '../config.js';
import db from '../lib/db.js';
import { validateMessage, createMessage, listMessages, previewAudience } from '../lib/messages.js';
import { dispatchJob } from '../lib/jobs.js';

// Sample values for a test send, so every variable shows something.
const SAMPLE = {
  lessonName: 'Getting Started',
  progress: '60%',
  progressSummary: 'This week you finished 2 lessons and you’re halfway through a third.',
  newLessons: 'New this week: Writing a System Prompt.',
};

export function registerNotificationRoutes(admin) {
  admin.get('/v1/admin/notifications', async (c) => {
    const [automations, templates] = await Promise.all([
      readAutomations(),
      Promise.all(Object.keys(TEMPLATES).map((id) => getTemplate(id))),
    ]);
    return c.json({ automations, templates });
  });

  // PUT /v1/admin/notifications/automations — body { waitlistConfirmation?: bool, … }
  admin.put('/v1/admin/notifications/automations', async (c) => {
    const result = await writeAutomations(await c.req.json().catch(() => null));
    if (result.error) return c.json({ error: result.error }, 400);
    return c.json(result);
  });

  admin.put('/v1/admin/notifications/templates/:id', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const result = await putTemplate(c.req.param('id'), body, c.get('user'));
    if (result.error) return c.json({ error: result.error }, result.status);
    return c.json(result);
  });

  // ── Messages (#389) ──
  const groupsOf = async () => (await db.getSyncData('_system', 'settings'))?.data?.userGroups || [];

  // POST /v1/admin/notifications/preview — body { audience }: who'd get it.
  admin.post('/v1/admin/notifications/preview', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const checked = validateMessage({ subject: 'x', body: 'x', inApp: true, audience: body.audience }, { groups: await groupsOf() });
    if (checked.error) return c.json({ error: checked.error }, 400);
    return c.json(await previewAudience(checked.message.audience));
  });

  admin.get('/v1/admin/notifications/messages', async (c) => c.json({ messages: await listMessages() }));

  // POST /v1/admin/notifications/messages — send now. In-app is visible at
  // once; email goes out in the background (`send-message` job).
  admin.post('/v1/admin/notifications/messages', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const checked = validateMessage(body, { groups: await groupsOf() });
    if (checked.error) return c.json({ error: checked.error }, 400);
    const user = c.get('user');
    const message = await createMessage(checked.message, user, undefined, { requestId: body.requestId });
    if (message.duplicate) return c.json({ message }, 200);
    if (message.email) await dispatchJob('send-message', { id: message.id });
    try {
      await db.createAuditLog({
        action: 'message_sent', userId: user.userId, performedBy: user.userId,
        details: { messageId: message.id, audience: message.audience.type, inApp: message.inApp, email: message.email, recipients: message.counts.recipients },
      });
    } catch { /* best-effort */ }
    return c.json({ message }, 201);
  });

  // Back to plato's default copy.
  admin.delete('/v1/admin/notifications/templates/:id', async (c) => {
    const result = await resetTemplate(c.req.param('id'));
    if (result.error) return c.json({ error: result.error }, result.status);
    return c.json(result);
  });

  // POST …/templates/:id/test — send the template (or the unsaved draft in the
  // body) to the signed-in admin, with sample values. No unsubscribe link.
  admin.post('/v1/admin/notifications/templates/:id/test', async (c) => {
    const id = c.req.param('id');
    const stored = await getTemplate(id);
    if (!stored) return c.json({ error: 'Unknown template' }, 404);
    const draft = await c.req.json().catch(() => ({}));
    const template = { subject: draft.subject ?? stored.subject, body: draft.body ?? stored.body };
    const error = validateTemplate(id, template);
    if (error) return c.json({ error }, 400);
    const user = c.get('user');
    const classroom = await getClassroom();
    const vars = { ...SAMPLE, firstName: nameFields(user).firstName || 'there', classroomName: classroom.name, link: `${APP_URL}/lessons` };
    const rendered = renderEmail(template, vars, { classroom, linkLabel: TEMPLATES[id].linkLabel });
    const result = await sendNotificationEmail({ to: user.email, ...rendered, subject: `[Test] ${rendered.subject}`, classroom });
    return c.json({ ...result, to: user.email });
  });
}
