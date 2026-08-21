import assert from 'node:assert/strict';
import test from 'node:test';
import { AcquisitionPathsError, acquireFromPaths } from '../src/acquisition.ts';

test('acquisition paths stop at the first successful path', async () => {
  const calls: string[] = [];
  const result = await acquireFromPaths([
    {
      id: 'first',
      acquire: () => {
        calls.push('first');
        return Promise.resolve('ok');
      },
    },
    {
      id: 'second',
      acquire: () => {
        calls.push('second');
        return Promise.resolve('unused');
      },
    },
  ]);

  assert.deepEqual(result, { value: 'ok', acquiredVia: 'first' });
  assert.deepEqual(calls, ['first']);
});

test('acquisition paths try the next path after failure', async () => {
  const calls: string[] = [];
  const result = await acquireFromPaths([
    {
      id: 'direct-api',
      acquire: () => {
        calls.push('direct-api');
        return Promise.reject(new Error('unavailable'));
      },
    },
    {
      id: 'app-server',
      acquire: () => {
        calls.push('app-server');
        return Promise.resolve(42);
      },
    },
  ]);

  assert.deepEqual(result, { value: 42, acquiredVia: 'app-server' });
  assert.deepEqual(calls, ['direct-api', 'app-server']);
});

test('acquisition paths retain ordered failures when all paths fail', async () => {
  await assert.rejects(
    () =>
      acquireFromPaths([
        { id: 'first', acquire: () => Promise.reject(new Error('first failed')) },
        { id: 'second', acquire: () => Promise.reject(new Error('second failed')) },
      ]),
    (error) => {
      assert.ok(error instanceof AcquisitionPathsError);
      assert.equal(error.message, 'All acquisition paths failed: first, second');
      assert.deepEqual(
        error.failures.map(({ pathId }) => pathId),
        ['first', 'second'],
      );
      return true;
    },
  );
});
