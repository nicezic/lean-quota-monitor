import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CUSTOM_STATUS_MAX_LENGTH,
  formatCustomStatus,
  normalizeCustomProviders,
  parseCustomOutput,
  truncateCustomStatus,
} from '../src/custom-provider.ts';

test('custom output accepts one logical value line with trailing newline', () => {
  assert.equal(parseCustomOutput('$46.82\n'), '$46.82');
});

test('custom output rejects empty and multiline stdout', () => {
  assert.throws(() => parseCustomOutput('   \n'), /empty stdout/);
  assert.throws(() => parseCustomOutput('line one\nline two\n'), /exactly one line/);
});

test('custom status truncates to ten characters including ellipsis', () => {
  assert.equal(CUSTOM_STATUS_MAX_LENGTH, 10);
  assert.equal(truncateCustomStatus('1234567890'), '1234567890');
  assert.equal(truncateCustomStatus('12345678901'), '123456789…');
});

test('custom provider config requires Provider Name, Status Bar Name, and Script Path', () => {
  assert.deepEqual(
    normalizeCustomProviders({
      MyProviderName: { label: 'MY', script: '~/.local/bin/my-provider-credit', visible: false },
      MissingLabel: { script: '~/.local/bin/missing-label' },
      EmptyLabel: { label: '   ', script: '~/.local/bin/empty-label' },
      LegacyString: '~/.local/bin/legacy-credit',
    }),
    {
      MyProviderName: { label: 'MY', script: '~/.local/bin/my-provider-credit', visible: false },
    },
  );
});

test('custom provider visibility defaults on', () => {
  assert.deepEqual(
    normalizeCustomProviders({
      MyProviderName: { label: 'MY', script: '~/.local/bin/my-provider-credit' },
    }),
    {
      MyProviderName: { label: 'MY', script: '~/.local/bin/my-provider-credit', visible: true },
    },
  );
});

test('custom status combines configured label with value-only script stdout', () => {
  assert.equal(formatCustomStatus('AIF', '$1.20'), 'AIF $1.20');
});
