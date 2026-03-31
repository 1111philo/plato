import { Hono } from 'hono';

const health = new Hono();

health.get('/v1/health', (c) => {
  return c.json({ status: 'ok', service: 'plato' });
});

export default health;
