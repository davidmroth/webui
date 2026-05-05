import test from 'node:test';
import assert from 'node:assert/strict';

import {
  appendInputHistory,
  COMPOSER_INPUT_HISTORY_LIMIT,
  loadInputHistory,
  navigateInputHistory,
  saveInputHistory
} from './input-history.ts';

test('appendInputHistory keeps only the most recent entries', () => {
  const history = Array.from({ length: COMPOSER_INPUT_HISTORY_LIMIT }, (_, index) => `message-${index}`);

  const next = appendInputHistory(history, 'message-latest');

  assert.equal(next.length, COMPOSER_INPUT_HISTORY_LIMIT);
  assert.equal(next[0], 'message-1');
  assert.equal(next.at(-1), 'message-latest');
});

test('loadInputHistory ignores malformed payloads and saveInputHistory stores capped history', () => {
  let storedValue = 'not-json';
  const storage = {
    getItem() {
      return storedValue;
    },
    setItem(_key, value) {
      storedValue = value;
    }
  };

  assert.deepEqual(loadInputHistory(storage, 'history-key'), []);

  saveInputHistory(storage, 'history-key', ['first', 'second']);

  assert.deepEqual(loadInputHistory(storage, 'history-key'), ['first', 'second']);
});

test('navigateInputHistory walks backward through history and restores the pending draft', () => {
  const entries = ['first', 'second', 'third'];

  const stepOne = navigateInputHistory({
    entries,
    currentDraft: 'draft in progress',
    direction: 'backward',
    index: null,
    pendingDraft: null
  });

  assert.deepEqual(stepOne, {
    nextDraft: 'third',
    nextIndex: 2,
    nextPendingDraft: 'draft in progress'
  });

  const stepTwo = navigateInputHistory({
    entries,
    currentDraft: stepOne.nextDraft,
    direction: 'backward',
    index: stepOne.nextIndex,
    pendingDraft: stepOne.nextPendingDraft
  });

  assert.deepEqual(stepTwo, {
    nextDraft: 'second',
    nextIndex: 1,
    nextPendingDraft: 'draft in progress'
  });

  const stepThree = navigateInputHistory({
    entries,
    currentDraft: stepTwo.nextDraft,
    direction: 'forward',
    index: stepTwo.nextIndex,
    pendingDraft: stepTwo.nextPendingDraft
  });

  assert.deepEqual(stepThree, {
    nextDraft: 'third',
    nextIndex: 2,
    nextPendingDraft: 'draft in progress'
  });

  const stepFour = navigateInputHistory({
    entries,
    currentDraft: stepThree.nextDraft,
    direction: 'forward',
    index: stepThree.nextIndex,
    pendingDraft: stepThree.nextPendingDraft
  });

  assert.deepEqual(stepFour, {
    nextDraft: 'draft in progress',
    nextIndex: null,
    nextPendingDraft: null
  });
});