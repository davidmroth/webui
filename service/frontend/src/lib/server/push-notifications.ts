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

const PUSH_BODY_MAX_LENGTH = 180;
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

function isExpiredSubscriptionError(error: unknown) {
  const candidate = error as PushErrorLike | null;
  const statusCode = Number(candidate?.statusCode ?? 0);
  return statusCode === 404 || statusCode === 410;
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
}) {
  if (!ensureWebPushConfigured()) {
    return;
  }

  const subscriptions = await listPushSubscriptionsForUser(options.userId);
  if (subscriptions.length === 0) {
    return;
  }

  const payload = JSON.stringify({
    title: `Hermes: ${options.conversationTitle || 'New chat'}`,
    body: formatPushNotificationBody(options.content),
    tag: `assistant-${options.messageId}`,
    url: `/chat?conversation=${options.conversationId}`,
    conversationId: options.conversationId,
    messageId: options.messageId
  });

  await Promise.all(
    subscriptions.map(async (subscriptionRow) => {
      const subscription = parseStoredPushSubscription(subscriptionRow.subscription);
      if (!subscription) {
        await deletePushSubscriptionById(subscriptionRow.id);
        return;
      }

      try {
        await webpush.sendNotification(subscription, payload, {
          TTL: 60,
          urgency: 'high'
        });
        await markPushSubscriptionSuccess(subscriptionRow.id);
      } catch (error) {
        if (isExpiredSubscriptionError(error)) {
          await deletePushSubscriptionById(subscriptionRow.id);
          return;
        }

        const errorText = describePushError(error);
        await markPushSubscriptionError(subscriptionRow.id, errorText);
        console.error('Failed to deliver Web Push notification', {
          userId: options.userId,
          conversationId: options.conversationId,
          messageId: options.messageId,
          subscriptionId: subscriptionRow.id,
          error: errorText
        });
      }
    })
  );
}