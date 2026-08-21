import assert from 'node:assert/strict';
import test from 'node:test';
import {
  type CustomProviderState,
  customDetail,
  customHasCurrentData,
  type ProviderState,
  providerDetail,
  providerHasCurrentData,
  providerStatusText,
} from '../src/monitor-presentation.ts';

test('quota presentation uses Week for status and 5h for detail', () => {
  const now = Date.parse('2026-08-19T00:00:00Z');
  const state: ProviderState = {
    snapshot: {
      kind: 'quota',
      id: 'openai',
      label: 'GPT',
      windows: [
        { label: '5h', usedPercent: 20, remainingPercent: 80 },
        {
          label: 'Week',
          usedPercent: 40,
          remainingPercent: 60,
          resetAt: new Date(now + 2 * 60 * 60_000),
        },
      ],
    },
  };

  assert.equal(providerStatusText('GPT', state, now), 'GPT 60% ↻2h');
  assert.match(providerDetail('Codex', 'GPT', state, now).block, /5h: 80%/);
  assert.equal(
    providerStatusText(
      'GPT',
      {
        snapshot:
          state.snapshot?.kind === 'quota'
            ? { ...state.snapshot, windows: [state.snapshot.windows[0]] }
            : undefined,
      },
      now,
    ),
    'GPT --',
  );
});

test('current errors hide stale provider data', () => {
  const providerState: ProviderState = {
    snapshot: {
      kind: 'credit',
      id: 'openrouter',
      label: 'OpenRouter',
      currency: 'USD',
      totalCredits: 100,
      usedCredits: 80,
      remainingCredits: 20,
    },
    error: new Error('request failed'),
  };
  const customState: CustomProviderState = { output: '$20', error: new Error('request failed') };

  assert.equal(providerHasCurrentData(providerState), false);
  assert.equal(providerStatusText('OR', providerState), 'OR --');
  assert.equal(customHasCurrentData(customState), false);
  assert.doesNotMatch(customDetail('Balance', customState).block, /\$20/);
});
