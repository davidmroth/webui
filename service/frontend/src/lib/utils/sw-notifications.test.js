import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

async function loadNotificationServiceWorker() {
  const listeners = new Map();
  const shownNotifications = [];
  const navigations = [];
  const openedWindows = [];
  const focusedClients = [];
  const script = await readFile(new URL('../../../static/sw-notifications.js', import.meta.url), 'utf8');
  const context = {
    URL,
    Date,
    self: {
      location: { origin: 'https://example.test' },
      addEventListener(type, listener) {
        listeners.set(type, listener);
      },
      registration: {
        async showNotification(title, options) {
          shownNotifications.push({ title, options });
        }
      },
      clients: {
        async matchAll() {
          return [
            {
              url: 'https://example.test/chat?conversation=conv-1',
              focused: true,
              visibilityState: 'visible',
              async focus() {
                focusedClients.push(this.url);
                return this;
              },
              async navigate(url) {
                navigations.push(url);
                return null;
              }
            }
          ];
        },
        async openWindow(url) {
          openedWindows.push(url);
          return null;
        }
      }
    }
  };

  vm.createContext(context);
  vm.runInContext(script, context, { filename: 'sw-notifications.js' });
  return { listeners, shownNotifications, navigations, openedWindows, focusedClients };
}

test('push events always show a user-visible notification even when a client looks visible', async () => {
  const { listeners, shownNotifications } = await loadNotificationServiceWorker();
  const pending = [];
  const pushListener = listeners.get('push');

  assert.equal(typeof pushListener, 'function');

  pushListener({
    data: {
      json() {
        return {
          title: 'Hermes: Test chat',
          body: 'Background reply',
          tag: 'assistant-message-1',
          url: '/chat?conversation=conv-1',
          conversationId: 'conv-1',
          messageId: 'message-1',
          runStatus: 'completed'
        };
      }
    },
    waitUntil(promise) {
      pending.push(promise);
    }
  });

  await Promise.all(pending);

  assert.equal(shownNotifications.length, 1);
  const [notification] = shownNotifications;
  assert.equal(notification.title, 'Hermes: Test chat');
  assert.equal(notification.options.body, 'Background reply');
  assert.equal(notification.options.tag, 'assistant-message-1');
  assert.equal(typeof notification.options.timestamp, 'number');
  assert.equal(notification.options.data.url, '/chat?conversation=conv-1');
  assert.equal(notification.options.data.conversationId, 'conv-1');
  assert.equal(notification.options.data.messageId, 'message-1');
  assert.equal(notification.options.data.runStatus, 'completed');
});

test('notification clicks focus an existing app window and navigate to the target conversation', async () => {
  const { listeners, navigations, openedWindows, focusedClients } = await loadNotificationServiceWorker();
  const pending = [];
  const clickListener = listeners.get('notificationclick');

  assert.equal(typeof clickListener, 'function');

  clickListener({
    notification: {
      data: { url: '/chat?conversation=conv-2' },
      close() {}
    },
    waitUntil(promise) {
      pending.push(promise);
    }
  });

  await Promise.all(pending);

  assert.deepEqual(focusedClients, ['https://example.test/chat?conversation=conv-1']);
  assert.deepEqual(navigations, ['https://example.test/chat?conversation=conv-2']);
  assert.deepEqual(openedWindows, []);
});
