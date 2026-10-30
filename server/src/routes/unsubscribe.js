/**
 * One-click unsubscribe (#400, RFC 8058). Notification emails link to
 * `GET /v1/unsubscribe?token=…`, which shows a confirm button (so link
 * scanners that open every URL can't unsubscribe anyone). Mail clients post to
 * the same URL from the `List-Unsubscribe-Post` header, which unsubscribes
 * at once. Tokens are HMAC-signed per user and kind (lib/notifications.js).
 */
import { Hono } from 'hono';
import { verifyUnsubscribeToken, setOptOut, UNSUBSCRIBE_KINDS } from '../lib/notifications.js';
import { escapeHtml, getClassroom, emailWrapper } from '../lib/email.js';

const unsubscribe = new Hono();

async function page(c, inner, status = 200) {
  const classroom = await getClassroom();
  return c.html(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Email settings — ${escapeHtml(classroom.name)}</title></head><body style="margin:0;background:#f6f6f6"><main>${emailWrapper(classroom, inner)}</main></body></html>`, status);
}

const invalid = (c) => page(c, '<h1 style="font-size:18px;margin:0 0 12px">This link isn’t valid</h1><p style="line-height:1.5;margin:0">You can change which emails you get in Settings, after signing in.</p>', 400);

unsubscribe.get('/v1/unsubscribe', async (c) => {
  const token = c.req.query('token');
  const parsed = verifyUnsubscribeToken(token);
  if (!parsed) return invalid(c);
  const label = escapeHtml(UNSUBSCRIBE_KINDS[parsed.kind]);
  return page(c, `<h1 style="font-size:18px;margin:0 0 12px">Unsubscribe from the ${label}?</h1>
    <form method="post" action="/v1/unsubscribe?token=${escapeHtml(encodeURIComponent(token))}">
      <button type="submit" style="font:inherit;font-weight:600;padding:10px 24px;border-radius:8px;border:0;background:#1a1a1a;color:#fff;cursor:pointer">Unsubscribe</button>
    </form>
    <p style="color:#555;font-size:13px;line-height:1.5;margin:16px 0 0">You can turn it back on in Settings.</p>`);
});

unsubscribe.post('/v1/unsubscribe', async (c) => {
  const parsed = verifyUnsubscribeToken(c.req.query('token'));
  if (!parsed) return invalid(c);
  await setOptOut(parsed.userId, { [parsed.kind]: true });
  const label = escapeHtml(UNSUBSCRIBE_KINDS[parsed.kind]);
  return page(c, `<h1 style="font-size:18px;margin:0 0 12px" role="status">You’re unsubscribed</h1><p style="line-height:1.5;margin:0">You won’t get the ${label} anymore. You can turn it back on in Settings.</p>`);
});

export default unsubscribe;
