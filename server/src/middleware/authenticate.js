import { verifyAccessToken } from '../lib/jwt.js';
import db from '../lib/db.js';

export async function authenticate(c, next) {
  const auth = c.req.header('Authorization');
  if (!auth?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid Authorization header' }, 401);
  }

  const token = auth.slice(7);
  let payload;
  try {
    payload = await verifyAccessToken(token);
  } catch {
    return c.json({ error: 'Invalid or expired token' }, 401);
  }

  const user = await db.getUserById(payload.sub);
  if (!user) {
    return c.json({ error: 'User not found' }, 401);
  }

  c.set('userId', user.userId);
  c.set('role', user.role);
  c.set('user', user);
  await next();
}
