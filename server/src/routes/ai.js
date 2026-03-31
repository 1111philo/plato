import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { authenticate } from '../middleware/authenticate.js';
import ai from '../lib/ai-provider.js';

const aiRoute = new Hono();

aiRoute.use('/v1/ai/*', authenticate);

aiRoute.post('/v1/ai/messages', async (c) => {
  const body = await c.req.json();
  const { model, max_tokens, system, messages, stream: isStream } = body;

  if (!model) return c.json({ error: 'model is required' }, 400);
  if (!messages || !Array.isArray(messages)) return c.json({ error: 'messages array is required' }, 400);

  const aiBody = {
    max_tokens: max_tokens || 1024,
    ...(system ? { system } : {}),
    messages,
  };

  if (!isStream) {
    const responseBody = await ai.invoke(model, aiBody);
    return c.json(responseBody);
  }

  c.header('Content-Type', 'text/event-stream');
  c.header('Cache-Control', 'no-cache');
  c.header('Connection', 'keep-alive');

  return stream(c, async (s) => {
    try {
      for await (const event of ai.invokeStream(model, aiBody)) {
        await s.write(`data: ${JSON.stringify(event)}\n\n`);
      }
      await s.write('data: [DONE]\n\n');
    } catch (err) {
      console.error('Streaming error:', err);
      await s.write(`data: ${JSON.stringify({ type: 'error', error: { message: err.message } })}\n\n`);
    }
  });
});

export default aiRoute;
// Keep backward compat — imported as `ai` in index.js
