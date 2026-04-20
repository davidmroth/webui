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
