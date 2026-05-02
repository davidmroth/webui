import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PUSH_NOTIFICATION_TTL_SECONDS,
  buildPushReplyNotificationPayload,
  buildWebPushNotificationOptions,
  classifyPushDeliveryError,
  getPushRetryDelaySeconds
} from './push-notifications.ts';

test('buildPushReplyNotificationPayload includes wake-up routing and run status', () => {
  const payload = buildPushReplyNotificationPayload({
    conversationId: 'conv-1',
    conversationTitle: 'Iran War Latest News Analysis',
    messageId: 'message-1',
    content: 'The completed explainer is ready.',
    runStatus: 'completed'
  });

  assert.deepEqual(payload, {
    title: 'Hermes: Iran War Latest News Analysis',
    body: 'The completed explainer is ready.',
    tag: 'assistant-message-1',
    url: '/chat?conversation=conv-1',
    conversationId: 'conv-1',
    messageId: 'message-1',
    runStatus: 'completed'
  });
});

test('buildPushReplyNotificationPayload truncates long bodies without losing routing fields', () => {
  const payload = buildPushReplyNotificationPayload({
    conversationId: 'conv-1',
    conversationTitle: '',
    messageId: 'message-1',
    content: 'x'.repeat(500),
    runStatus: 'failed'
  });

  assert.equal(payload.title, 'Hermes: New chat');
  assert.equal(payload.body.length, 180);
  assert.equal(payload.body.endsWith('...'), true);
  assert.equal(payload.runStatus, 'failed');
  assert.equal(payload.url, '/chat?conversation=conv-1');
});

test('buildWebPushNotificationOptions uses a mobile-friendly TTL', () => {
  assert.deepEqual(buildWebPushNotificationOptions(), {
    TTL: PUSH_NOTIFICATION_TTL_SECONDS,
    urgency: 'high'
  });
  assert.equal(PUSH_NOTIFICATION_TTL_SECONDS, 24 * 60 * 60);
});

test('classifyPushDeliveryError removes expired subscriptions without retry', () => {
  assert.deepEqual(classifyPushDeliveryError({ statusCode: 410, body: 'Gone' }), {
    code: 'subscription_expired',
    message: 'Gone',
    retryable: false,
    removeSubscription: true
  });
});

test('classifyPushDeliveryError retries transient push service failures', () => {
  assert.deepEqual(classifyPushDeliveryError({ statusCode: 503, message: 'Try later' }), {
    code: 'push_service_unavailable',
    message: 'Try later',
    retryable: true,
    removeSubscription: false
  });

  assert.deepEqual(classifyPushDeliveryError({ statusCode: 429, body: 'Too many requests' }), {
    code: 'rate_limited',
    message: 'Too many requests',
    retryable: true,
    removeSubscription: false
  });
});

test('getPushRetryDelaySeconds backs off and caps retry delays', () => {
  assert.equal(getPushRetryDelaySeconds(1), 60);
  assert.equal(getPushRetryDelaySeconds(2), 120);
  assert.equal(getPushRetryDelaySeconds(6), 1_920);
  assert.equal(getPushRetryDelaySeconds(12), 3_600);
});
