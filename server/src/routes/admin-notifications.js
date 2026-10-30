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
