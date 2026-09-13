import assert from 'node:assert/strict';
import test from 'node:test';
import {
  moveProvider,
  moveProviderAmong,
  normalizeProviderOrder,
  removeProviderFromOrder,
  renameProviderInOrder,
} from '../src/provider-order.ts';

test('provider order maintains deduplication, boundaries, and visibility mutations', () => {
  // Normalization: keeps valid configured keys, drops stale/duplicates, appends missing
  assert.deepEqual(
    normalizeProviderOrder(
      ['gemini', 'stale', 'openai', 'gemini'],
      ['openai', 'anthropic', 'gemini', 'Custom'],
    ),
    ['gemini', 'openai', 'anthropic', 'Custom'],
  );

  // Reordering: moves position, respects boundary edges, and skips hidden keys
  const order = ['a', 'b', 'c'];
  assert.deepEqual(moveProvider(order, 'b', 'up'), ['b', 'a', 'c']);
  assert.deepEqual(moveProvider(order, 'b', 'down'), ['a', 'c', 'b']);
  assert.deepEqual(moveProvider(order, 'a', 'up'), order);
  assert.deepEqual(moveProvider(order, 'c', 'down'), order);
  assert.deepEqual(moveProviderAmong(['a', 'hidden', 'b', 'c'], 'b', 'up', ['a', 'b', 'c']), [
    'b',
    'hidden',
    'a',
    'c',
  ]);

  // Rename & remove
  assert.deepEqual(renameProviderInOrder(['a', 'old', 'new'], 'old', 'new'), ['a', 'new']);
  assert.deepEqual(removeProviderFromOrder(['a', 'b', 'a'], 'a'), ['b']);
});
