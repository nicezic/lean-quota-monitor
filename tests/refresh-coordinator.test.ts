import assert from 'node:assert/strict';
import test from 'node:test';
import { RefreshCoordinator } from '../src/refresh-coordinator.ts';

function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test('concurrent refresh joins the active run', async () => {
  const coordinator = new RefreshCoordinator();
  const gate = deferred();
  let runs = 0;
  const task = () => {
    runs += 1;
    return gate.promise;
  };

  const active = coordinator.run('provider', task);
  await Promise.resolve();
  const joined = coordinator.run('provider', task);

  assert.equal(joined, active);
  gate.resolve();
  await active;
  assert.equal(runs, 1);
});

test('rerun keeps only the latest task queued behind the active run', async () => {
  const coordinator = new RefreshCoordinator();
  const gate = deferred();
  const calls: string[] = [];
  const active = coordinator.run('provider', async () => {
    calls.push('active');
    await gate.promise;
  });
  await Promise.resolve();

  coordinator.run(
    'provider',
    () => {
      calls.push('superseded');
      return Promise.resolve();
    },
    'rerun',
  );
  coordinator.run(
    'provider',
    () => {
      calls.push('latest');
      return Promise.resolve();
    },
    'rerun',
  );
  gate.resolve();

  await active;
  assert.deepEqual(calls, ['active', 'latest']);
});
