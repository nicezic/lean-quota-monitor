import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import {
  CUSTOM_STATUS_MAX_LENGTH,
  formatCustomStatus,
  normalizeCustomProviders,
  parseCustomOutput,
  resolveCustomScriptPath,
  runCustomScript,
  truncateCustomStatus,
} from '../src/custom-provider.ts';
import { ProviderError } from '../src/provider-error.ts';

test('custom output accepts one logical value line with trailing newline', () => {
  assert.equal(parseCustomOutput('$46.82\n'), '$46.82');
});

test('custom output rejects empty and multiline stdout with SCRIPT_BAD_OUTPUT', () => {
  assert.throws(
    () => parseCustomOutput('   \n'),
    (error) => error instanceof ProviderError && error.code === 'SCRIPT_BAD_OUTPUT',
  );
  assert.throws(
    () => parseCustomOutput('line one\nline two\n'),
    (error) => error instanceof ProviderError && error.code === 'SCRIPT_BAD_OUTPUT',
  );
});

test('empty Script Path is classified as SCRIPT_NOT_FOUND', () => {
  assert.throws(
    () => resolveCustomScriptPath('   '),
    (error) => error instanceof ProviderError && error.code === 'SCRIPT_NOT_FOUND',
  );
});

test('custom status truncates to ten characters including ellipsis', () => {
  assert.equal(CUSTOM_STATUS_MAX_LENGTH, 10);
  assert.equal(truncateCustomStatus('1234567890'), '1234567890');
  assert.equal(truncateCustomStatus('12345678901'), '123456789…');
});

test('custom provider config requires Provider Name, Status Bar Name, and Script Path', () => {
  assert.deepEqual(
    normalizeCustomProviders({
      MyProviderName: {
        statusBarName: 'MY',
        script: '~/.local/bin/my-provider-credit',
        visible: false,
      },
      MissingLabel: { script: '~/.local/bin/missing-label' },
      EmptyLabel: { statusBarName: '   ', script: '~/.local/bin/empty-label' },
      LegacyString: '~/.local/bin/legacy-credit',
    }),
    {
      MyProviderName: {
        statusBarName: 'MY',
        script: '~/.local/bin/my-provider-credit',
        visible: false,
      },
    },
  );
});

test('custom provider visibility defaults on', () => {
  assert.deepEqual(
    normalizeCustomProviders({
      MyProviderName: { statusBarName: 'MY', script: '~/.local/bin/my-provider-credit' },
    }),
    {
      MyProviderName: {
        statusBarName: 'MY',
        script: '~/.local/bin/my-provider-credit',
        visible: true,
      },
    },
  );
});

test('custom status combines configured label with value-only script stdout', () => {
  assert.equal(formatCustomStatus('AIF', '$1.20'), 'AIF $1.20');
});

test('missing custom script is classified as SCRIPT_NOT_FOUND', async () => {
  await assert.rejects(
    () => runCustomScript('/nonexistent/lqm-missing-script'),
    (error) =>
      error instanceof ProviderError &&
      error.code === 'SCRIPT_NOT_FOUND' &&
      error.message === 'Not Found',
  );
});

test('failing custom script exit code is classified as SCRIPT_FAILED', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lqm-script-test-'));
  const script = path.join(dir, 'fail.sh');
  fs.writeFileSync(script, '#!/bin/sh\nexit 3\n');
  fs.chmodSync(script, 0o755);
  try {
    await assert.rejects(
      () => runCustomScript(script),
      (error) =>
        error instanceof ProviderError &&
        error.code === 'SCRIPT_FAILED' &&
        error.message === 'Script failed with exit code 3',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
