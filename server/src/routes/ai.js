import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { authenticate } from '../middleware/authenticate.js';
import bedrock from '../lib/bedrock.js';

const ai = new Hono();

ai.use('/v1/ai/*', authenticate);

// Map Anthropic API model IDs to Bedrock inference profile IDs
const MODEL_MAP = {
  'claude-haiku-4-5-20251001': 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
  'claude-sonnet-4-6': 'us.anthropic.claude-sonnet-4-6',
};

ai.post('/v1/ai/messages', async (c) => {
  const body = await c.req.json();
  const { model, max_tokens, system, messages, stream: isStream } = body;

  if (!model) return c.json({ error: 'model is required' }, 400);
  if (!messages || !Array.isArray(messages)) return c.json({ error: 'messages array is required' }, 400);

  const bedrockModelId = MODEL_MAP[model] || model;

  const bedrockBody = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: max_tokens || 1024,
    ...(system ? { system } : {}),
    messages,
  };

  if (!isStream) {
    const responseBody = await bedrock.invoke(bedrockModelId, bedrockBody);
    return c.json(responseBody);
  }

  // Streaming response — pipe Bedrock SSE chunks to the client
  c.header('Content-Type', 'text/event-stream');
  c.header('Cache-Control', 'no-cache');
  c.header('Connection', 'keep-alive');

  return stream(c, async (s) => {
    try {
      for await (const event of bedrock.invokeStream(bedrockModelId, bedrockBody)) {
        await s.write(`data: ${JSON.stringify(event)}\n\n`);
      }
      await s.write('data: [DONE]\n\n');
    } catch (err) {
      console.error('Streaming error:', err);
      await s.write(`data: ${JSON.stringify({ type: 'error', error: { message: err.message } })}\n\n`);
    }
  });
});

export default ai;
