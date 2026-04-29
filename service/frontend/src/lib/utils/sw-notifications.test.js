import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

async function loadNotificationServiceWorker() {
  const listeners = new Map();
  const shownNotifications = [];
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
                return this;
              },
              async navigate() {
                return null;
              }
            }
          ];
        },
        async openWindow() {
          return null;
        }
      }
    }
  };

  vm.createContext(context);
  vm.runInContext(script, context, { filename: 'sw-notifications.js' });
  return { listeners, shownNotifications };
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
          messageId: 'message-1'
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
});
