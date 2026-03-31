export async function requireAdmin(c, next) {
  if (c.get('role') !== 'admin') {
    return c.json({ error: 'Admin access required' }, 403);
  }
  await next();
}
