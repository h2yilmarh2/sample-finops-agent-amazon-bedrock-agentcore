import {
  BedrockAgentCoreClient,
  InvokeAgentRuntimeCommand,
} from '@aws-sdk/client-bedrock-agentcore';
import { getAwsCredentials } from './auth';
import type { AppSettings } from '../types';

export async function invokeAgent(
  prompt: string,
  sessionId: string,
  userId: string,
  settings: AppSettings
): Promise<string> {
  const credentials = getAwsCredentials(settings);

  const client = new BedrockAgentCoreClient({
    region: settings.region,
    credentials,
  });

  const payload = JSON.stringify({
    prompt,
    sessionId,
    userId,
  });

  const command = new InvokeAgentRuntimeCommand({
    agentRuntimeArn: settings.agentCoreArn,
    qualifier: 'DEFAULT',
    payload: new TextEncoder().encode(payload),
    contentType: 'application/json',
    accept: 'application/json',
  });

  const result = await client.send(command);

  // Handle the streaming response
  const responseBody = result.response;
  if (!responseBody) {
    throw new Error('Empty response from agent');
  }

  let resultBytes: Uint8Array;

  if (responseBody instanceof Uint8Array) {
    resultBytes = responseBody;
  } else if (typeof (responseBody as AsyncIterable<Uint8Array>)[Symbol.asyncIterator] === 'function') {
    // Async iterable stream - collect all chunks
    const chunks: Uint8Array[] = [];
    for await (const chunk of responseBody as AsyncIterable<Uint8Array>) {
      chunks.push(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk as ArrayBuffer));
    }
    const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
    resultBytes = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      resultBytes.set(chunk, offset);
      offset += chunk.length;
    }
  } else if (responseBody instanceof Blob) {
    const buffer = await responseBody.arrayBuffer();
    resultBytes = new Uint8Array(buffer);
  } else {
    // ReadableStream
    const reader = (responseBody as ReadableStream<Uint8Array>).getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
    resultBytes = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      resultBytes.set(chunk, offset);
      offset += chunk.length;
    }
  }

  const decoded = new TextDecoder().decode(resultBytes);

  // Try to parse as JSON and extract result field
  try {
    const json = JSON.parse(decoded);
    return json.result || json.message || json.output || decoded;
  } catch {
    // If not valid JSON, return raw text
    return decoded;
  }
}
