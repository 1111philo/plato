/**
 * AI provider abstraction — supports Amazon Bedrock or direct Anthropic API.
 *
 * Set AI_PROVIDER env var:
 *   "bedrock"    — uses AWS Bedrock (requires AWS credentials, default for Lambda)
 *   "anthropic"  — uses Anthropic API directly (requires ANTHROPIC_API_KEY)
 *
 * Default: "anthropic" if ANTHROPIC_API_KEY is set, otherwise "bedrock"
 */

const provider = process.env.AI_PROVIDER
  || (process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'bedrock');

let ai;

if (provider === 'anthropic') {
  // Direct Anthropic API
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const baseUrl = 'https://api.anthropic.com/v1/messages';

  ai = {
    async invoke(model, body) {
      const res = await fetch(baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({ model, ...body }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `Anthropic API error ${res.status}`);
      }
      return res.json();
    },

    async *invokeStream(model, body) {
      const res = await fetch(baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({ model, ...body, stream: true }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `Anthropic API error ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          if (data === '[DONE]') return;
          try { yield JSON.parse(data); } catch { /* skip */ }
        }
      }
    },
  };
} else {
  // Amazon Bedrock
  const { BedrockRuntimeClient, InvokeModelCommand, InvokeModelWithResponseStreamCommand } = await import('@aws-sdk/client-bedrock-runtime');
  const client = new BedrockRuntimeClient({ region: process.env.AWS_REGION || 'us-east-2' });

  // Map Anthropic model IDs to Bedrock inference profile IDs
  const MODEL_MAP = {
    'claude-haiku-4-5-20251001': 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
    'claude-sonnet-4-6': 'us.anthropic.claude-sonnet-4-6',
  };

  ai = {
    async invoke(model, body) {
      const modelId = MODEL_MAP[model] || model;
      const command = new InvokeModelCommand({
        modelId,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({ anthropic_version: 'bedrock-2023-05-31', ...body }),
      });
      const response = await client.send(command);
      return JSON.parse(new TextDecoder().decode(response.body));
    },

    async *invokeStream(model, body) {
      const modelId = MODEL_MAP[model] || model;
      const command = new InvokeModelWithResponseStreamCommand({
        modelId,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({ anthropic_version: 'bedrock-2023-05-31', ...body }),
      });
      const response = await client.send(command);
      for await (const event of response.body) {
        if (event.chunk) {
          yield JSON.parse(new TextDecoder().decode(event.chunk.bytes));
        }
      }
    },
  };
}

console.log(`AI provider: ${provider}`);

export default ai;
