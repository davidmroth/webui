import { json } from '@sveltejs/kit';
import { requireSession } from '$server/auth';
import {
  deletePushSubscription,
  hasWebPushConfiguration,
  normalizeStoredPushSubscription,
  upsertPushSubscription
} from '$server/push-notifications';

export async function POST(event) {
  const session = await requireSession(event);
  if (!hasWebPushConfiguration()) {
    return json(
      { error: 'Web Push is not configured on this server.' },
      { status: 503 }
    );
  }

  const body = await event.request.json().catch(() => null);
  const subscription = normalizeStoredPushSubscription(body?.subscription);
  if (!subscription) {
    return json({ error: 'A valid push subscription is required.' }, { status: 400 });
  }

  await upsertPushSubscription(session.userId, subscription, {
    userAgent: event.request.headers.get('user-agent')
  });

  return json({ ok: true, endpoint: subscription.endpoint });
}

export async function DELETE(event) {
  const session = await requireSession(event);
  const body = await event.request.json().catch(() => null);
  const endpoint = typeof body?.endpoint === 'string' ? body.endpoint.trim() : '';
  if (!endpoint) {
    return json({ error: 'Push subscription endpoint is required.' }, { status: 400 });
  }

  await deletePushSubscription(session.userId, endpoint);
  return json({ ok: true });
}