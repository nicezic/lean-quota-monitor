import assert from 'node:assert/strict';
import test from 'node:test';
import {
  moveProvider,
  moveProviderAmong,
  normalizeProviderOrder,
  removeProviderFromOrder,
  renameProviderInOrder,
} from '../src/provider-order.ts';

test('provider order keeps valid configured keys and appends missing providers', () => {
  assert.deepEqual(
    normalizeProviderOrder(
      ['gemini', 'stale', 'openai', 'gemini'],
      ['openai', 'anthropic', 'gemini', 'Custom'],
    ),
    ['gemini', 'openai', 'anthropic', 'Custom'],
  );
});

test('provider order moves one position and respects boundaries', () => {
  const order = ['a', 'b', 'c'];
  assert.deepEqual(moveProvider(order, 'b', 'up'), ['b', 'a', 'c']);
  assert.deepEqual(moveProvider(order, 'b', 'down'), ['a', 'c', 'b']);
  assert.deepEqual(moveProvider(order, 'a', 'up'), order);
  assert.deepEqual(moveProvider(order, 'c', 'down'), order);
});

test('provider order moves among visible keys while skipping hidden keys', () => {
  assert.deepEqual(moveProviderAmong(['a', 'hidden', 'b', 'c'], 'b', 'up', ['a', 'b', 'c']), [
    'b',
    'hidden',
    'a',
    'c',
  ]);
});

test('provider order renames and de-duplicates a key', () => {
  assert.deepEqual(renameProviderInOrder(['a', 'old', 'new'], 'old', 'new'), ['a', 'new']);
});

test('provider order removes a provider key', () => {
  assert.deepEqual(removeProviderFromOrder(['a', 'b', 'a'], 'a'), ['b']);
});
