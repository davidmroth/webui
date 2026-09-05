import assert from 'node:assert/strict';
import test from 'node:test';

import { startBriefingArchiveStream } from './briefing-archive.ts';

class FakeEventSource {
  static instances = [];

  constructor(url) {
    this.url = url;
    this.listeners = new Map();
    this.closed = false;
    FakeEventSource.instances.push(this);
  }

  addEventListener(name, listener) {
    this.listeners.set(name, listener);
  }

  removeEventListener(name, listener) {
    if (this.listeners.get(name) === listener) {
      this.listeners.delete(name);
    }
  }

  close() {
    this.closed = true;
  }

  emit(name) {
    this.listeners.get(name)?.();
  }
}

test('briefing archive stream refreshes on briefing events and cleans up', () => {
  FakeEventSource.instances = [];
  let refreshes = 0;
  const stop = startBriefingArchiveStream({
    basePath: '/console/',
    EventSourceImpl: FakeEventSource,
    onBriefing: () => {
      refreshes += 1;
    }
  });

  const source = FakeEventSource.instances[0];
  assert.equal(source.url, '/console/api/briefings/catalog/stream');

  source.emit('briefing');
  assert.equal(refreshes, 1);

  stop();
  assert.equal(source.closed, true);
  source.emit('briefing');
  assert.equal(refreshes, 1);
});
