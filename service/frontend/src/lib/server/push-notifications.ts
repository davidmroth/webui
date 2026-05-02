import { createHash, randomUUID } from 'node:crypto';
import webpush from 'web-push';
import { execute, query } from './db';
import { getConfig } from './env';

type StoredPushSubscription = {
  endpoint: string;
  expirationTime?: number | null;
  keys?: {
    auth?: string;
    p256dh?: string;
  };
};

interface PushSubscriptionRow {
  id: string;
  subscription: string | StoredPushSubscription;
}

interface PushErrorLike {
  statusCode?: number;
  body?: string;
  message?: string;
}

interface PushNotificationQueueRow {
  id: string;
  user_id: string;
  conversation_id: string;
  message_id: string | null;
  payload: string | ReturnType<typeof buildPushReplyNotificationPayload>;
  attempt_count: number;
}

export type PushDeliveryFailureCode =
  | 'subscription_expired'
  | 'rate_limited'
  | 'push_service_unavailable'
  | 'push_unauthorized'
  | 'push_delivery_failed';

export interface PushDeliveryFailure {
  code: PushDeliveryFailureCode;
  message: string;
  retryable: boolean;
  removeSubscription: boolean;
}

const PUSH_BODY_MAX_LENGTH = 180;
export const PUSH_NOTIFICATION_TTL_SECONDS = 24 * 60 * 60;
export const PUSH_NOTIFICATION_URGENCY = 'high';
export const PUSH_QUEUE_MAX_ATTEMPTS = 5;
const PUSH_QUEUE_PERMANENT_FAILURE_NEXT_ATTEMPT = '9999-12-31 23:59:59';
let configuredVapidSignature: string | null = null;

function hashEndpoint(endpoint: string) {
  return createHash('sha256').update(endpoint).digest('hex');
}

function trimString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizePushKeys(value: unknown) {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const auth = trimString(record.auth);
  const p256dh = trimString(record.p256dh);
  if (!auth || !p256dh) {
    return undefined;
  }

  return { auth, p256dh };
}

export function normalizeStoredPushSubscription(value: unknown): StoredPushSubscription | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const endpoint = trimString(record.endpoint);
  if (!endpoint) {
    return null;
  }

  const keys = normalizePushKeys(record.keys);
  if (!keys) {
    return null;
  }
  const expirationTime =
    typeof record.expirationTime === 'number' && Number.isFinite(record.expirationTime)
      ? record.expirationTime
      : null;

  return {
    endpoint,
    expirationTime,
    ...(keys ? { keys } : {})
  };
}

function parseStoredPushSubscription(value: string | StoredPushSubscription) {
  if (typeof value === 'string') {
    try {
      return normalizeStoredPushSubscription(JSON.parse(value));
    } catch {
      return null;
    }
  }

  return normalizeStoredPushSubscription(value);
}

export function hasWebPushConfiguration() {
  const config = getConfig();
  return Boolean(
    config.webPushVapidSubject.trim() &&
      config.publicWebPushVapidPublicKey.trim() &&
      config.webPushVapidPrivateKey.trim()
  );
}

function ensureWebPushConfigured() {
  if (!hasWebPushConfiguration()) {
    return null;
  }

  const config = getConfig();
  const subject = config.webPushVapidSubject.trim();
  const publicKey = config.publicWebPushVapidPublicKey.trim();
  const privateKey = config.webPushVapidPrivateKey.trim();

  const signature = `${subject}:${publicKey}:${privateKey}`;
  if (configuredVapidSignature !== signature) {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    configuredVapidSignature = signature;
  }

  return { subject, publicKey, privateKey };
}

function formatPushNotificationBody(content: string) {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return 'Assistant sent a new message.';
  }

  if (normalized.length <= PUSH_BODY_MAX_LENGTH) {
    return normalized;
  }

  return `${normalized.slice(0, PUSH_BODY_MAX_LENGTH - 3)}...`;
}

export type PushNotificationRunStatus = 'completed' | 'failed' | 'cancelled' | 'stale' | 'needs_attention';

export function buildPushReplyNotificationPayload(options: {
  conversationId: string;
  conversationTitle: string;
  messageId: string;
  content: string;
  runStatus?: PushNotificationRunStatus;
}) {
  return {
    title: `Hermes: ${options.conversationTitle || 'New chat'}`,
    body: formatPushNotificationBody(options.content),
    tag: `assistant-${options.messageId}`,
    url: `/chat?conversation=${options.conversationId}`,
    conversationId: options.conversationId,
    messageId: options.messageId,
    runStatus: options.runStatus ?? 'completed'
  };
}

export function buildWebPushNotificationOptions() {
  return {
    TTL: PUSH_NOTIFICATION_TTL_SECONDS,
    urgency: PUSH_NOTIFICATION_URGENCY
  };
}

function describePushError(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  const candidate = error as PushErrorLike | null;
  if (candidate?.body && candidate.body.trim()) {
    return candidate.body.trim();
  }
  if (candidate?.message && candidate.message.trim()) {
    return candidate.message.trim();
  }

  return 'Unknown push delivery error.';
}

export function classifyPushDeliveryError(error: unknown): PushDeliveryFailure {
  const candidate = error as PushErrorLike | null;
  const statusCode = Number(candidate?.statusCode ?? 0);
  const message = describePushError(error);

  if (statusCode === 404 || statusCode === 410) {
    return {
      code: 'subscription_expired',
      message,
      retryable: false,
      removeSubscription: true
    };
  }

  if (statusCode === 429) {
    return {
      code: 'rate_limited',
      message,
      retryable: true,
      removeSubscription: false
    };
  }

  if (statusCode >= 500) {
    return {
      code: 'push_service_unavailable',
      message,
      retryable: true,
      removeSubscription: false
    };
  }

  if (statusCode === 401 || statusCode === 403) {
    return {
      code: 'push_unauthorized',
      message,
      retryable: false,
      removeSubscription: false
    };
  }

  return {
    code: 'push_delivery_failed',
    message,
    retryable: statusCode === 0,
    removeSubscription: false
  };
}

export function getPushRetryDelaySeconds(attemptCount: number) {
  const normalizedAttempt = Math.max(1, Math.floor(attemptCount));
  return Math.min(60 * 60, 60 * 2 ** (normalizedAttempt - 1));
}

async function markPushSubscriptionSuccess(subscriptionId: string) {
  await execute(
    `UPDATE push_subscriptions
     SET last_success_at = UTC_TIMESTAMP(),
         last_error_at = NULL,
         last_error_text = NULL
     WHERE id = :id`,
    { id: subscriptionId }
  );
}

async function markPushSubscriptionError(subscriptionId: string, errorText: string) {
  await execute(
    `UPDATE push_subscriptions
     SET last_error_at = UTC_TIMESTAMP(),
         last_error_text = :error_text
     WHERE id = :id`,
    { id: subscriptionId, error_text: errorText }
  );
}

async function deletePushSubscriptionById(subscriptionId: string) {
  await execute('DELETE FROM push_subscriptions WHERE id = :id', { id: subscriptionId });
}

async function listPushSubscriptionsForUser(userId: string) {
  return query<PushSubscriptionRow>(
    `SELECT id, subscription
     FROM push_subscriptions
     WHERE user_id = :user_id
     ORDER BY updated_at DESC`,
    { user_id: userId }
  );
}

function parseQueuedPushPayload(value: PushNotificationQueueRow['payload']) {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object'
        ? (parsed as ReturnType<typeof buildPushReplyNotificationPayload>)
        : null;
    } catch {
      return null;
    }
  }

  return value && typeof value === 'object' ? value : null;
}

function eventTypeForRunStatus(runStatus: PushNotificationRunStatus | undefined) {
  if (runStatus === 'failed') {
    return 'assistant_failed';
  }
  if (runStatus === 'stale') {
    return 'assistant_stale';
  }
  if (runStatus === 'needs_attention') {
    return 'needs_attention';
  }
  return 'assistant_completed';
}

export async function enqueuePushNotification(options: {
  userId: string;
  conversationId: string;
  messageId: string;
  conversationTitle: string;
  content: string;
  runStatus?: PushNotificationRunStatus;
}) {
  const id = randomUUID();
  const payload = buildPushReplyNotificationPayload(options);

  await execute(
    `INSERT INTO push_notification_queue
       (id, user_id, conversation_id, message_id, event_type, payload, status, next_attempt_at)
     VALUES
       (:id, :user_id, :conversation_id, :message_id, :event_type, :payload, 'queued', UTC_TIMESTAMP())`,
    {
      id,
      user_id: options.userId,
      conversation_id: options.conversationId,
      message_id: options.messageId,
      event_type: eventTypeForRunStatus(options.runStatus),
      payload: JSON.stringify(payload)
    }
  );

  return id;
}

async function markPushQueueSent(queueId: string) {
  await execute(
    `UPDATE push_notification_queue
     SET status = 'sent',
         last_error_code = NULL,
         last_error_text = NULL
     WHERE id = :id`,
    { id: queueId }
  );
}

async function markPushQueueFailed(queueId: string, failure: PushDeliveryFailure, attemptCount: number) {
  const exhausted = !failure.retryable || attemptCount >= PUSH_QUEUE_MAX_ATTEMPTS;
  await execute(
    `UPDATE push_notification_queue
     SET status = 'failed',
         last_error_code = :last_error_code,
         last_error_text = :last_error_text,
         next_attempt_at = ${exhausted ? ':next_attempt_at' : 'UTC_TIMESTAMP() + INTERVAL :retry_delay SECOND'}
     WHERE id = :id`,
    {
      id: queueId,
      last_error_code: failure.code,
      last_error_text: failure.message,
      retry_delay: getPushRetryDelaySeconds(attemptCount),
      next_attempt_at: PUSH_QUEUE_PERMANENT_FAILURE_NEXT_ATTEMPT
    }
  );
}

async function deliverPushPayloadToUser(
  userId: string,
  payload: ReturnType<typeof buildPushReplyNotificationPayload>
) {
  if (!ensureWebPushConfigured()) {
    return {
      ok: false,
      failure: {
        code: 'push_unauthorized',
        message: 'Web Push VAPID configuration is missing.',
        retryable: false,
        removeSubscription: false
      } satisfies PushDeliveryFailure
    };
  }

  const subscriptions = await listPushSubscriptionsForUser(userId);
  if (subscriptions.length === 0) {
    return { ok: true };
  }

  const payloadText = JSON.stringify(payload);
  let delivered = 0;
  let lastFailure: PushDeliveryFailure | null = null;

  await Promise.all(
    subscriptions.map(async (subscriptionRow) => {
      const subscription = parseStoredPushSubscription(subscriptionRow.subscription);
      if (!subscription) {
        await deletePushSubscriptionById(subscriptionRow.id);
        return;
      }

      try {
        await webpush.sendNotification(subscription, payloadText, buildWebPushNotificationOptions());
        delivered += 1;
        await markPushSubscriptionSuccess(subscriptionRow.id);
      } catch (error) {
        const failure = classifyPushDeliveryError(error);
        lastFailure = failure;
        if (failure.removeSubscription) {
          await deletePushSubscriptionById(subscriptionRow.id);
          return;
        }

        await markPushSubscriptionError(subscriptionRow.id, failure.message);
      }
    })
  );

  if (delivered > 0 || !lastFailure) {
    return { ok: true };
  }

  return { ok: false, failure: lastFailure };
}

export async function processQueuedPushNotifications(options: { limit?: number } = {}) {
  const limit = Math.max(1, Math.min(100, Math.floor(options.limit ?? 25)));
  const rows = await query<PushNotificationQueueRow>(
    `SELECT id, user_id, conversation_id, message_id, payload, attempt_count
     FROM push_notification_queue
     WHERE status IN ('queued', 'failed')
       AND attempt_count < :max_attempts
       AND next_attempt_at <= UTC_TIMESTAMP()
     ORDER BY next_attempt_at ASC, created_at ASC
     LIMIT ${limit}`,
    { max_attempts: PUSH_QUEUE_MAX_ATTEMPTS }
  );

  let sent = 0;
  let failed = 0;

  for (const row of rows) {
    const payload = parseQueuedPushPayload(row.payload);
    const nextAttemptCount = row.attempt_count + 1;

    await execute(
      `UPDATE push_notification_queue
       SET status = 'processing',
           attempt_count = attempt_count + 1,
           last_attempt_at = UTC_TIMESTAMP()
       WHERE id = :id
         AND status IN ('queued', 'failed')`,
      { id: row.id }
    );

    if (!payload) {
      await markPushQueueFailed(
        row.id,
        {
          code: 'push_delivery_failed',
          message: 'Queued push notification payload is invalid.',
          retryable: false,
          removeSubscription: false
        },
        nextAttemptCount
      );
      failed += 1;
      continue;
    }

    const result = await deliverPushPayloadToUser(row.user_id, payload);
    if (result.ok) {
      await markPushQueueSent(row.id);
      sent += 1;
      continue;
    }

    await markPushQueueFailed(row.id, result.failure, nextAttemptCount);
    failed += 1;
    console.error('Failed to deliver queued Web Push notification', {
      userId: row.user_id,
      conversationId: row.conversation_id,
      messageId: row.message_id,
      queueId: row.id,
      error: result.failure.message,
      errorCode: result.failure.code
    });
  }

  return { scanned: rows.length, sent, failed };
}

export async function upsertPushSubscription(
  userId: string,
  subscription: StoredPushSubscription,
  options: { userAgent?: string | null } = {}
) {
  await execute(
    `INSERT INTO push_subscriptions (id, user_id, endpoint_hash, subscription, user_agent)
     VALUES (:id, :user_id, :endpoint_hash, :subscription, :user_agent)
     ON DUPLICATE KEY UPDATE
       user_id = VALUES(user_id),
       subscription = VALUES(subscription),
       user_agent = VALUES(user_agent),
       updated_at = CURRENT_TIMESTAMP,
       last_error_at = NULL,
       last_error_text = NULL`,
    {
      id: randomUUID(),
      user_id: userId,
      endpoint_hash: hashEndpoint(subscription.endpoint),
      subscription: JSON.stringify(subscription),
      user_agent: options.userAgent?.trim() || null
    }
  );
}

export async function deletePushSubscription(userId: string, endpoint: string) {
  const normalizedEndpoint = endpoint.trim();
  if (!normalizedEndpoint) {
    return;
  }

  await execute(
    `DELETE FROM push_subscriptions
     WHERE user_id = :user_id AND endpoint_hash = :endpoint_hash`,
    {
      user_id: userId,
      endpoint_hash: hashEndpoint(normalizedEndpoint)
    }
  );
}

export async function sendPushReplyNotification(options: {
  userId: string;
  conversationId: string;
  conversationTitle: string;
  messageId: string;
  content: string;
  runStatus?: PushNotificationRunStatus;
}) {
  if (!ensureWebPushConfigured()) {
    return;
  }

  await enqueuePushNotification(options);
  await processQueuedPushNotifications({ limit: 25 });
}
