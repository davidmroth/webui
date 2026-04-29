self.addEventListener('push', (event) => {
  const payload = readPushPayload(event);
  const title = payload.title || 'Hermes';
  const body = payload.body || 'Assistant sent a new message.';
  const tag = payload.tag || `assistant-${Date.now()}`;
  const targetUrl = payload.url || '/chat';

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      timestamp: Date.now(),
      data: {
        url: targetUrl,
        conversationId: payload.conversationId || null,
        messageId: payload.messageId || null
      }
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  const notification = event.notification;
  const targetUrl = (notification && notification.data && notification.data.url) || '/chat';

  notification.close();

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        const clientUrl = new URL(client.url);
        const target = new URL(targetUrl, self.location.origin);

        if (clientUrl.origin === target.origin) {
          return client.focus().then(() => {
            if ('navigate' in client) {
              return client.navigate(target.href);
            }
            return null;
          });
        }
      }

      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }

      return null;
    })
  );
});

function readPushPayload(event) {
  if (!event.data) {
    return {};
  }

  try {
    const payload = event.data.json();
    return payload && typeof payload === 'object' ? payload : {};
  } catch {
    try {
      const text = event.data.text();
      const payload = JSON.parse(text);
      return payload && typeof payload === 'object' ? payload : {};
    } catch {
      return {};
    }
  }
}
