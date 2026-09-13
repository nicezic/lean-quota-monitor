import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatCustomStatus,
  normalizeCustomProviders,
  parseCustomOutput,
  runCustomScript,
  truncateCustomStatus,
} from '../src/custom-provider.ts';
import { ProviderError } from '../src/provider-error.ts';

test('custom provider config normalizes valid entries and filters invalid', () => {
  assert.deepEqual(
    normalizeCustomProviders({
      A: { statusBarName: 'MY', script: '~/.bin/my', visible: false },
      B: { statusBarName: 'OK', script: '/bin/ok' }, // defaults to visible: true
      MissingLabel: { script: '/bin/script' },
      EmptyLabel: { statusBarName: '   ', script: '/bin/script' },
      Invalid: 'string',
    }),
    {
      A: { statusBarName: 'MY', script: '~/.bin/my', visible: false },
      B: { statusBarName: 'OK', script: '/bin/ok', visible: true },
    },
  );
});

test('custom output parses single line and enforces formatting/limits', () => {
  assert.equal(parseCustomOutput('$46.82\n'), '$46.82');
  assert.equal(truncateCustomStatus('12345678901'), '123456789…');
  assert.equal(formatCustomStatus('AIF', '$1.20'), 'AIF $1.20');

  assert.throws(
    () => parseCustomOutput('line1\nline2'),
    (e) => e instanceof ProviderError && e.code === 'SCRIPT_BAD_OUTPUT',
  );
  assert.throws(
    () => parseCustomOutput('   '),
    (e) => e instanceof ProviderError && e.code === 'SCRIPT_BAD_OUTPUT',
  );
});

test('custom script execution classifies missing and failed scripts', async () => {
  await assert.rejects(
    () => runCustomScript('   '),
    (e) => e instanceof ProviderError && e.code === 'SCRIPT_NOT_FOUND',
  );
  await assert.rejects(
    () => runCustomScript('/nonexistent/lqm-missing-script'),
    (e) => e instanceof ProviderError && e.code === 'SCRIPT_NOT_FOUND',
  );
  await assert.rejects(
    () => runCustomScript('/usr/bin/false'),
    (e) => e instanceof ProviderError && e.code === 'SCRIPT_FAILED',
  );
});
