/**
 * The model the evaluations call: plato's own (`ai-provider.js` LLM, through
 * Bedrock Converse, as the app does), with the developer's AWS login. A test
 * can pass a stub instead (`stubModel`), so the harness is tested without the
 * model.
 */
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { toConverseRequest, fromConverseResponse } from '../../../src/lib/converse.js';

export const MODEL_ID = 'qwen.qwen3-vl-235b-a22b';

/**
 * `call({ system, messages, maxTokens, temperature })` → reply text. Counts
 * calls, tokens and time in `stats`.
 */
export function bedrockModel({ region = process.env.AWS_REGION || 'us-east-2', modelId = MODEL_ID } = {}) {
  const client = new BedrockRuntimeClient({ region, retryMode: 'adaptive', maxAttempts: 6 });
  const stats = { calls: 0, ms: 0, inTokens: 0, outTokens: 0 };
  return {
    id: modelId,
    stats,
    async call({ system, messages, maxTokens = 1024, temperature }) {
      const t0 = Date.now();
      const res = fromConverseResponse(await client.send(new ConverseCommand(toConverseRequest(modelId, {
        system, messages, max_tokens: maxTokens, ...(temperature != null ? { temperature } : {}),
      }))));
      stats.calls++; stats.ms += Date.now() - t0;
      stats.inTokens += res.usage?.input_tokens || 0; stats.outTokens += res.usage?.output_tokens || 0;
      return res.content.map((b) => b.text || '').join('');
    },
  };
}

/** A stand-in model for the harness's own tests: `reply(request)` returns the text. */
export function stubModel(reply) {
  const stats = { calls: 0, ms: 0, inTokens: 0, outTokens: 0 };
  return { id: 'stub', stats, async call(req) { stats.calls++; return reply(req); } };
}
