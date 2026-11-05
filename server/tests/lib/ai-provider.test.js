/**
 * BEDROCK_MODEL_ARN lets a developer's local server call their own tagged
 * access point. It must never change which model production calls.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveModelId, LLM } from '../../src/lib/ai-provider.js';

const ARN = 'arn:aws:bedrock:us-east-2:123456789012:application-inference-profile/abc123';

describe('resolveModelId', () => {
  it('maps LLM to the Qwen model ID by default', () => {
    assert.equal(resolveModelId(LLM, {}), 'qwen.qwen3-vl-235b-a22b');
  });

  it('uses BEDROCK_MODEL_ARN for LLM in local dev', () => {
    assert.equal(resolveModelId(LLM, { BEDROCK_MODEL_ARN: ARN }), ARN);
  });

  it('ignores BEDROCK_MODEL_ARN on Lambda', () => {
    assert.equal(resolveModelId(LLM, { BEDROCK_MODEL_ARN: ARN, AWS_LAMBDA_FUNCTION_NAME: 'plato-api' }), 'qwen.qwen3-vl-235b-a22b');
  });

  it('leaves other model names alone', () => {
    assert.equal(resolveModelId('claude-haiku-4-5-20251001', { BEDROCK_MODEL_ARN: ARN }), 'us.anthropic.claude-haiku-4-5-20251001-v1:0');
  });
});
