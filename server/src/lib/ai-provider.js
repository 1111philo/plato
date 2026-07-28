/**
 * AI provider abstraction — Amazon Bedrock.
 *
 * plato runs a single open source model everywhere (see `LLM` below). All nine
 * agents share it; there is no per-agent routing.
 *
 * Non-Anthropic models on Bedrock are only reachable through the Converse API.
 * The legacy `InvokeModel` path does not reject them — it returns HTTP 200 with
 * an OpenAI-shaped body, so callers silently read `undefined` instead of text.
 * Callers here always speak the Anthropic Messages shape; `converse.js`
 * translates at the Bedrock boundary. Anthropic model IDs still take the legacy
 * path so a Claude fallback stays a one-line `LLM` change.
 *
 * The direct Anthropic API provider was removed once plato moved to open
 * weights — Bedrock is the only backend. Local dev uses Bedrock too, via
 * whatever AWS credentials are in the environment (see docs/DEPLOY.md).
 */

import {
  BedrockRuntimeClient,
  InvokeModelCommand,
  InvokeModelWithResponseStreamCommand,
  ConverseCommand,
  ConverseStreamCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { toConverseRequest, fromConverseResponse, fromConverseStreamEvent } from './converse.js';

// Timeout for Bedrock requests — set just under the Lambda function timeout
// (120 s) so errors propagate cleanly rather than causing a hard Lambda kill.
const BEDROCK_TIMEOUT_MS = 115_000;

const client = new BedrockRuntimeClient({ region: process.env.AWS_REGION || 'us-east-2' });

// Map friendly model IDs to Bedrock model / inference-profile IDs. Open-weight
// models are invoked by bare model ID (no `us.` cross-region prefix); Anthropic
// models need the inference-profile prefix.
const MODEL_MAP = {
  'qwen3-vl-235b': 'qwen.qwen3-vl-235b-a22b',
  'claude-haiku-4-5-20251001': 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
  'claude-sonnet-4-6': 'us.anthropic.claude-sonnet-4-6',
};

/** Anthropic models use the legacy InvokeModel body; everything else Converse. */
function usesLegacyInvoke(modelId) {
  return modelId.includes('anthropic.');
}

function withTimeout(label) {
  const abortController = new AbortController();
  const timer = setTimeout(
    () => abortController.abort(new Error(`Bedrock ${label} timed out after ${BEDROCK_TIMEOUT_MS}ms`)),
    BEDROCK_TIMEOUT_MS,
  );
  return { abortSignal: abortController.signal, clear: () => clearTimeout(timer) };
}

const ai = {
  async invoke(model, body) {
    const modelId = MODEL_MAP[model] || model;
    const { abortSignal, clear } = withTimeout('invoke');
    try {
      if (usesLegacyInvoke(modelId)) {
        const command = new InvokeModelCommand({
          modelId,
          contentType: 'application/json',
          accept: 'application/json',
          body: JSON.stringify({ anthropic_version: 'bedrock-2023-05-31', ...body }),
        });
        const response = await client.send(command, { abortSignal });
        return JSON.parse(new TextDecoder().decode(response.body));
      }

      const response = await client.send(new ConverseCommand(toConverseRequest(modelId, body)), { abortSignal });
      return fromConverseResponse(response);
    } finally {
      clear();
    }
  },

  async *invokeStream(model, body) {
    const modelId = MODEL_MAP[model] || model;
    const { abortSignal, clear } = withTimeout('stream');
    try {
      if (usesLegacyInvoke(modelId)) {
        const command = new InvokeModelWithResponseStreamCommand({
          modelId,
          contentType: 'application/json',
          accept: 'application/json',
          body: JSON.stringify({ anthropic_version: 'bedrock-2023-05-31', ...body }),
        });
        const response = await client.send(command, { abortSignal });
        for await (const event of response.body) {
          if (event.chunk) {
            yield JSON.parse(new TextDecoder().decode(event.chunk.bytes));
          }
        }
        return;
      }

      const response = await client.send(new ConverseStreamCommand(toConverseRequest(modelId, body)), { abortSignal });
      for await (const event of response.stream) {
        const translated = fromConverseStreamEvent(event);
        if (translated) yield translated;
      }
    } finally {
      clear();
    }
  },
};

/**
 * The single model behind every plato agent. Qwen3-VL 235B A22B is the only
 * model on Bedrock us-east-2 that satisfies all four constraints: image input
 * (learners paste screenshots into the coach), reliable emission of plato's
 * literal `[PROGRESS: n]` / `[KB_UPDATE: {…}]` tags, awarding `10` on
 * completion, and — decisively — an **OSI-approved license** (Apache-2.0).
 *
 * That last one is a constraint, not a preference: plato is AGPL-3.0, and the
 * goal was an *open source* model, not merely an open-weight one. Llama 4
 * Maverick and Gemma 3 ship under bespoke community licenses that are not
 * OSI-approved, which is why neither is here despite passing every functional
 * check (Maverick measured faster and cheaper).
 *
 * `us.meta.llama4-maverick-17b-instruct-v1:0` is the tested fallback if Qwen's
 * latency tail becomes a production problem — a one-line change here plus the
 * mirror in client/js/api.js. Switching means knowingly dropping below the open
 * source bar; make that trade deliberately, not as a config tweak.
 *
 * → docs/MODEL_SELECTION.md for the full evaluation.
 */
export const LLM = 'qwen3-vl-235b';

console.log(`AI provider: bedrock (${MODEL_MAP[LLM] || LLM})`);

export default ai;
