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
import { pickPresentedWindow } from '../src/types.ts';

test('quota presentation formats status text, detail, and respects preemption and thresholds', () => {
  const now = Date.parse('2026-08-19T00:00:00Z');
  const normalState: ProviderState = {
    snapshot: {
      kind: 'quota',
      providerId: 'openai',
      presentedWindow: '1week',
      windows: [
        { type: '5hour', usedPercent: 20, remainingPercent: 80 },
        { type: '1day', usedPercent: 30, remainingPercent: 70 },
        {
          type: '1week',
          usedPercent: 40,
          remainingPercent: 60,
          resetAt: new Date(now + 2 * 60 * 60_000),
        },
      ],
    },
  };

  // Normal status text and detail joining secondary windows with middle dot
  assert.equal(providerStatusText('GPT', normalState, undefined, now), 'GPT 60% 1w 2h');
  const detail = providerDetail('Codex', 'GPT', normalState, undefined, now);
  assert.match(detail.block, /\[1day\] 70% · \[5hour\] 80%/);

  // Empty windows fallback
  assert.equal(
    providerStatusText('GPT', {
      snapshot:
        normalState.snapshot?.kind === 'quota'
          ? { ...normalState.snapshot, windows: [] }
          : undefined,
    }),
    'GPT --',
  );

  // User primary window override (without urgency)
  assert.equal(providerStatusText('GPT', normalState, '5hour', now), 'GPT 80% 5h');

  // Urgent preemption (<= 20%) overrides primary window and adds warning icon
  const urgentState: ProviderState = {
    snapshot: {
      kind: 'quota',
      providerId: 'openai',
      presentedWindow: '1week',
      windows: [
        { type: '5hour', usedPercent: 85, remainingPercent: 15 },
        { type: '1week', usedPercent: 40, remainingPercent: 60 },
      ],
    },
  };
  assert.equal(providerStatusText('GPT', urgentState, '1week'), '⚠️ GPT 15% 5h');

  // Low quota warning thresholds: disabled (null) and custom (10%)
  assert.equal(providerStatusText('GPT', urgentState, '1week', null), 'GPT 60% 1w');
  assert.equal(providerStatusText('GPT', urgentState, '1week', 10), 'GPT 60% 1w');
});

test('pickPresentedWindow resolves selection rules', () => {
  // 1. Primary window selected when all above threshold
  assert.equal(
    pickPresentedWindow(
      [
        { type: '5hour', usedPercent: 50, remainingPercent: 50 },
        { type: '1week', usedPercent: 30, remainingPercent: 70 },
      ],
      '1week',
    ),
    '1week',
  );

  // 2. Preempted by non-primary window at or below 20%
  assert.equal(
    pickPresentedWindow(
      [
        { type: '5hour', usedPercent: 85, remainingPercent: 15 },
        { type: '1week', usedPercent: 40, remainingPercent: 60 },
      ],
      '1week',
    ),
    '5hour',
  );

  // 3. Ties favor shorter duration
  assert.equal(
    pickPresentedWindow(
      [
        { type: '5hour', usedPercent: 90, remainingPercent: 10 },
        { type: '1week', usedPercent: 90, remainingPercent: 10 },
      ],
      '1week',
    ),
    '5hour',
  );

  // 4. Fallback to windows[0] when primary is missing
  assert.equal(
    pickPresentedWindow([{ type: '5hour', usedPercent: 50, remainingPercent: 50 }], '1week'),
    '5hour',
  );
});

test('credit and custom providers format status and detail', () => {
  const creditState: ProviderState = {
    snapshot: {
      kind: 'credit',
      providerId: 'deepseek',
      currency: 'CNY',
      totalCredits: 110,
      usedCredits: 0,
      remainingCredits: 110,
      formattedRemaining: '¥110.00',
    },
  };
  assert.equal(providerStatusText('DS', creditState), 'DS ¥110.00');
  assert.match(
    providerDetail('DeepSeek', 'DS', creditState).block,
    /\*\*DeepSeek\*\* `DS` \*\*¥110\.00\*\*/,
  );

  const customState: CustomProviderState = { output: '42' };
  assert.match(
    customDetail('My Script', customState, Date.now(), 'my').block,
    /\*\*My Script\*\* `my` \*\*42\*\*/,
  );
});

test('errors hide stale provider and custom data', () => {
  const providerState: ProviderState = {
    snapshot: {
      kind: 'credit',
      providerId: 'openrouter',
      currency: 'USD',
      totalCredits: 100,
      usedCredits: 80,
      remainingCredits: 20,
      formattedRemaining: '$20.00',
    },
    error: new Error('request failed'),
  };
  const customState: CustomProviderState = { output: '$20', error: new Error('request failed') };

  assert.equal(providerHasCurrentData(providerState), false);
  assert.equal(providerStatusText('OR', providerState), 'OR --');
  assert.equal(customHasCurrentData(customState), false);
  assert.doesNotMatch(customDetail('Balance', customState).block, /\$20/);
});
