import test from 'node:test';
import assert from 'node:assert/strict';
import { postAssistantMessage } from './hermes-webui-client.ts';

test('postAssistantMessage forwards sender trace session metadata', async () => {
  let capturedUrl = null;
  let capturedInit = null;

  const result = await postAssistantMessage(
    {
      baseUrl: 'https://webui.example/',
      serviceToken: 'service-token',
      fetchImpl: async (url, init) => {
        capturedUrl = String(url);
        capturedInit = init ?? null;
        return new Response(JSON.stringify({ ok: true, messageId: 'assistant-1' }), {
          status: 201,
          headers: {
            'Content-Type': 'application/json'
          }
        });
      }
    },
    {
      conversationId: 'conversation-1',
      content: 'assistant reply',
      senderTrace: {
        route: 'webchat',
        sessionPlatform: 'webui-conversation',
        sessionChatId: 'conversation-1'
      },
      timings: {
        prompt_n: 42
      }
    }
  );

  assert.equal(result.messageId, 'assistant-1');
  assert.equal(
    capturedUrl,
    'https://webui.example/api/internal/hermes/conversations/conversation-1/assistant'
  );
  assert.ok(capturedInit);
  assert.equal(capturedInit?.method, 'POST');
  assert.deepEqual(capturedInit?.headers, {
    Authorization: 'Bearer service-token',
    'Content-Type': 'application/json'
  });

  const payload = JSON.parse(String(capturedInit?.body ?? '{}'));
  assert.equal(payload.content, 'assistant reply');
  assert.deepEqual(payload.senderTrace, {
    route: 'webchat',
    sessionPlatform: 'webui-conversation',
    sessionChatId: 'conversation-1'
  });
  assert.deepEqual(payload.timings, {
    prompt_n: 42
  });
});