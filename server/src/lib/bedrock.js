import { BedrockRuntimeClient, InvokeModelCommand, InvokeModelWithResponseStreamCommand } from '@aws-sdk/client-bedrock-runtime';

const client = new BedrockRuntimeClient({ region: process.env.AWS_REGION || 'us-east-2' });

const bedrock = {
  async invoke(modelId, body) {
    const command = new InvokeModelCommand({
      modelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(body),
    });
    const response = await client.send(command);
    return JSON.parse(new TextDecoder().decode(response.body));
  },

  async *invokeStream(modelId, body) {
    const command = new InvokeModelWithResponseStreamCommand({
      modelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(body),
    });
    const response = await client.send(command);
    for await (const event of response.body) {
      if (event.chunk) {
        yield JSON.parse(new TextDecoder().decode(event.chunk.bytes));
      }
    }
  },
};

export default bedrock;
