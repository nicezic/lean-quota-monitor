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

test('quota presentation formats status text and detail using presentedWindow', () => {
  const now = Date.parse('2026-08-19T00:00:00Z');
  const state: ProviderState = {
    snapshot: {
      kind: 'quota',
      providerId: 'openai',
      presentedWindow: '1week',
      windows: [
        { type: '5hour', usedPercent: 20, remainingPercent: 80 },
        {
          type: '1week',
          usedPercent: 40,
          remainingPercent: 60,
          resetAt: new Date(now + 2 * 60 * 60_000),
        },
      ],
    },
  };

  assert.equal(providerStatusText('GPT', state, undefined, now), 'GPT 60% 1w 2h');
  assert.match(providerDetail('Codex', 'GPT', state, undefined, now).block, /\[5hour\] 80%/);
  assert.equal(
    providerStatusText(
      'GPT',
      {
        snapshot: state.snapshot?.kind === 'quota' ? { ...state.snapshot, windows: [] } : undefined,
      },
      undefined,
      now,
    ),
    'GPT --',
  );
});

test('a user primary window overrides presentedWindow but keeps urgent preemption', () => {
  const state: ProviderState = {
    snapshot: {
      kind: 'quota',
      providerId: 'openai',
      presentedWindow: '1week',
      windows: [
        { type: '5hour', usedPercent: 50, remainingPercent: 50 },
        { type: '1week', usedPercent: 30, remainingPercent: 70 },
      ],
    },
  };
  assert.equal(providerStatusText('GPT', state, '5hour'), 'GPT 50% 5h');

  const urgent: ProviderState = {
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
  assert.equal(providerStatusText('GPT', urgent, '1week'), '⚠️ GPT 15% 5h');
});

test('current errors hide stale provider data', () => {
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

test('credit presentation formats detail with 20-char credit badge', () => {
  const state: ProviderState = {
    snapshot: {
      kind: 'credit',
      providerId: 'openrouter',
      currency: 'USD',
      totalCredits: 100,
      usedCredits: 80,
      remainingCredits: 20,
      formattedRemaining: '$20.00',
    },
  };
  const detail = providerDetail('OpenRouter', 'OR', state);
  assert.equal(detail.block, '`░░░░░░ credit ░░░░░░`  **OpenRouter** `OR` **$20.00**');
});

test('credit presentation renders provider-formatted currency text', () => {
  const state: ProviderState = {
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
  assert.equal(providerStatusText('DS', state), 'DS ¥110.00');
  const detail = providerDetail('DeepSeek', 'DS', state);
  assert.equal(detail.block, '`░░░░░░ credit ░░░░░░`  **DeepSeek** `DS` **¥110.00**');
});

test('custom presentation formats detail with 20-char custom badge', () => {
  const state: CustomProviderState = { output: '42' };
  const detail = customDetail('My Script', state, Date.now(), 'my');
  assert.equal(detail.block, '`░░░░░░ custom ░░░░░░`  **My Script** `my` **42**');
});

test('pickPresentedWindow selects primary window when all windows are above threshold', () => {
  const windows = [
    { type: '5hour' as const, usedPercent: 50, remainingPercent: 50 },
    { type: '1week' as const, usedPercent: 30, remainingPercent: 70 },
  ];
  assert.equal(pickPresentedWindow(windows, '1week'), '1week');
});

test('pickPresentedWindow is preempted by non-primary window at or below 20%', () => {
  const windows = [
    { type: '5hour' as const, usedPercent: 85, remainingPercent: 15 },
    { type: '1week' as const, usedPercent: 40, remainingPercent: 60 },
  ];
  assert.equal(pickPresentedWindow(windows, '1week'), '5hour');
});

test('pickPresentedWindow resolves ties by favoring shorter window durations', () => {
  const windows = [
    { type: '5hour' as const, usedPercent: 90, remainingPercent: 10 },
    { type: '1week' as const, usedPercent: 90, remainingPercent: 10 },
  ];
  assert.equal(pickPresentedWindow(windows, '1week'), '5hour');
});

test('pickPresentedWindow falls back to windows[0] when primary window is missing', () => {
  const windows = [{ type: '5hour' as const, usedPercent: 50, remainingPercent: 50 }];
  assert.equal(pickPresentedWindow(windows, '1week'), '5hour');
});

test('providerDetail joins multiple secondary windows with middle dot', () => {
  const now = Date.now();
  const state: ProviderState = {
    snapshot: {
      kind: 'quota',
      providerId: 'openai',
      presentedWindow: '5hour',
      windows: [
        { type: '5hour', usedPercent: 10, remainingPercent: 90 },
        { type: '1day', usedPercent: 20, remainingPercent: 80 },
        { type: '1week', usedPercent: 30, remainingPercent: 70 },
      ],
    },
  };
  const detail = providerDetail('Codex', 'GPT', state, undefined, now);
  assert.match(detail.block, /\[1week\] 70% · \[1day\] 80%/);
});

test('low quota warning threshold triggers warning emoji and window preemption', () => {
  const state: ProviderState = {
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

  // Default threshold (20%): triggers warning on 5hour window (15% remaining)
  assert.equal(providerStatusText('GPT', state, '1week', 20), '⚠️ GPT 15% 5h');

  // Warning disabled (null / off): no ⚠️, primary window stays intact
  assert.equal(providerStatusText('GPT', state, '1week', null), 'GPT 60% 1w');

  // Custom threshold 10%: 15% remaining does NOT trigger warning or preemption
  assert.equal(providerStatusText('GPT', state, '1week', 10), 'GPT 60% 1w');

  // At or below custom threshold (10% remaining <= 10% threshold): triggers warning
  const criticalState: ProviderState = {
    snapshot: {
      kind: 'quota',
      providerId: 'openai',
      presentedWindow: '1week',
      windows: [
        { type: '5hour', usedPercent: 90, remainingPercent: 10 },
        { type: '1week', usedPercent: 40, remainingPercent: 60 },
      ],
    },
  };
  assert.equal(providerStatusText('GPT', criticalState, '1week', 10), '⚠️ GPT 10% 5h');
});
