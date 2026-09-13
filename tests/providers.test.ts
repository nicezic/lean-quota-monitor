import assert from 'node:assert/strict';
import test from 'node:test';
import { parseClaudeQuota } from '../src/providers/anthropic.ts';
import { parseCopilotQuota } from '../src/providers/copilot.ts';
import { parseDeepSeekBalance } from '../src/providers/deepseek.ts';
import {
  encodeLengthDelimited,
  encodeVarint,
  extractDevinApiKey,
  parseDevinQuota,
  parseDevinUserStatus,
} from '../src/providers/devin.ts';
import { parseAgyQuota } from '../src/providers/gemini.ts';
import { parseKimiQuota } from '../src/providers/kimi.ts';
import { parseMiniMaxQuota } from '../src/providers/minimax.ts';
import { parseCodexAppServerRateLimits, parseCodexDirectQuota } from '../src/providers/openai.ts';
import { parseOpenCodeGoUsage } from '../src/providers/opencode.ts';
import { parseOpenRouterCredits } from '../src/providers/openrouter.ts';
import { parseZaiQuota } from '../src/providers/zai.ts';

test('Gemini parses bucket ids from agy command_result', () => {
  const line = JSON.stringify({
    event: 'command_result',
    command: {
      data: {
        groups: [
          {
            name: 'Gemini Models',
            buckets: [
              { id: 'gemini-weekly', remaining_fraction: 0.8, reset_time: '2026-08-22T00:00:00Z' },
              { id: 'gemini-5h', remaining_fraction: 0.9, reset_time: '2026-08-18T12:00:00Z' },
            ],
          },
        ],
      },
    },
  });
  assert.deepEqual(
    parseAgyQuota(line).map((x) => [x.type, x.remainingPercent]),
    [
      ['1week', 80],
      ['5hour', 90],
    ],
  );
});

test('MiniMax parses model remains and rejects empty quota', () => {
  const snapshot = parseMiniMaxQuota({
    base_resp: { status_code: 0 },
    model_remains: [
      { current_interval_remaining_percent: 82, current_weekly_remaining_percent: 71 },
      { current_interval_remaining_percent: 76, current_weekly_remaining_percent: 90 },
    ],
  });
  assert.deepEqual(
    snapshot.windows.map((x) => [x.type, x.remainingPercent]),
    [
      ['1week', 71],
      ['5hour', 76],
    ],
  );

  assert.throws(
    () => parseMiniMaxQuota({ base_resp: { status_code: 0 }, model_remains: [{}] }),
    (e) => (e as { code?: string }).code === 'SCHEMA_CHANGED',
  );
});

test('Kimi parses weekly and 5h quota and rejects invalid windows', () => {
  const snapshot = parseKimiQuota({
    usage: { limit: '2048', used: '214', remaining: '1834', resetTime: '2026-08-25T00:00:00Z' },
    limits: [
      {
        window: { duration: 300, timeUnit: 'TIME_UNIT_MINUTE' },
        detail: { limit: '200', used: '139', remaining: '61', resetTime: '2026-08-19T09:00:00Z' },
      },
    ],
  });

  assert.deepEqual(
    snapshot.windows.map((x) => [x.type, Math.round(x.remainingPercent)]),
    [
      ['1week', 90],
      ['5hour', 31],
    ],
  );

  assert.throws(
    () => parseKimiQuota({ usage: { limit: '0', used: '0' }, limits: [] }),
    (e) => (e as { code?: string }).code === 'SCHEMA_CHANGED',
  );
});

test('Codex parses app-server and direct quotas, rejecting non-positive duration', () => {
  const appServer = parseCodexAppServerRateLimits({
    rateLimitsByLimitId: {
      codex: {
        limitId: 'codex',
        primary: { usedPercent: 20, windowDurationMins: 300, resetsAt: 1_787_000_000 },
        secondary: { usedPercent: 35, windowDurationMins: 10_080, resetsAt: 1_787_500_000 },
      },
    },
  });
  assert.deepEqual(
    appServer.windows.map((x) => [x.type, x.remainingPercent]),
    [
      ['1week', 65],
      ['5hour', 80],
    ],
  );

  const direct = parseCodexDirectQuota({
    rate_limit: { primary_window: { used_percent: 10, limit_window_seconds: 604_800 } },
  });
  assert.deepEqual(
    direct.windows.map((x) => [x.type, x.remainingPercent]),
    [['1week', 90]],
  );

  assert.throws(
    () => parseCodexDirectQuota({ rate_limit: { primary_window: { used_percent: 25 } } }),
    (e) => (e as { code?: string }).code === 'SCHEMA_CHANGED',
  );
});

test('Z.AI parses token windows by type and duration, rejecting invalid shapes', () => {
  const snapshot = parseZaiQuota({
    data: {
      limits: [
        { type: 'TIME_LIMIT', unit: 5, number: 1, percentage: 12.3, nextResetTime: 1788000000000 },
        {
          type: 'TOKENS_LIMIT',
          unit: 6,
          number: 1,
          percentage: '52',
          nextResetTime: '1787500000000',
        },
        {
          type: 'TOKENS_LIMIT',
          unit: 3,
          number: 5,
          percentage: 40.5,
          nextResetTime: 1787000000000,
        },
      ],
    },
  });

  assert.deepEqual(
    snapshot.windows.map((x) => [x.type, x.remainingPercent]),
    [
      ['1week', 48],
      ['5hour', 59.5],
    ],
  );
  assert.equal(snapshot.windows[0].resetAt?.toISOString(), new Date(1787500000000).toISOString());

  assert.throws(
    () => parseZaiQuota({ data: { limits: [{ type: 'POINTS_LIMIT', percentage: 10 }] } }),
    (e) => (e as { code?: string }).code === 'SCHEMA_CHANGED',
  );
});

test('OpenRouter parses remaining credits and rejects invalid numeric fields', () => {
  const snapshot = parseOpenRouterCredits({
    data: { total_credits: 100.5, total_usage: 25.75 },
  });
  assert.equal(snapshot.kind, 'credit');
  assert.equal(snapshot.remainingCredits, 74.75);
  assert.equal(snapshot.totalCredits, 100.5);
  assert.equal(snapshot.usedCredits, 25.75);

  assert.throws(
    () => parseOpenRouterCredits({ data: {} }),
    (e) => (e as { code?: string }).code === 'SCHEMA_CHANGED',
  );
});

test('OpenCode Go parses rolling/weekly/monthly windows and rejects invalid responses', () => {
  const snapshot = parseOpenCodeGoUsage({
    usage: {
      rolling: { percent: 25, resetsAt: '2026-08-24T12:00:00.000Z' },
      weekly: { percent: 52.5, resetsAt: '2026-08-28T00:00:00.000Z' },
      monthly: { percent: 100, resetsAt: '2026-09-01T00:00:00.000Z' },
    },
  });

  assert.equal(snapshot.kind, 'quota');
  assert.deepEqual(
    snapshot.windows.map((x) => [x.type, x.usedPercent, x.remainingPercent]),
    [
      ['1month', 100, 0],
      ['1week', 52.5, 47.5],
      ['5hour', 25, 75],
    ],
  );

  assert.throws(
    () => parseOpenCodeGoUsage({ usage: { rolling: {} } }),
    (e) => (e as { code?: string }).code === 'SCHEMA_CHANGED',
  );
});

test('Claude parses OAuth 5-hour and 7-day usage windows', () => {
  const snapshot = parseClaudeQuota({
    five_hour: { utilization: 23, resets_at: '2026-08-18T15:00:00Z' },
    seven_day: { utilization: 41, resets_at: '2026-08-24T00:00:00Z' },
  });
  assert.deepEqual(
    snapshot.windows.map((x) => [x.type, x.remainingPercent]),
    [
      ['1week', 59],
      ['5hour', 77],
    ],
  );
  assert.equal(snapshot.windows[0].resetAt?.toISOString(), '2026-08-24T00:00:00.000Z');
});

test('DeepSeek parses CNY and USD balances with currency formatting and rejects empty balance', () => {
  const cny = parseDeepSeekBalance({
    is_available: true,
    balance_infos: [
      {
        currency: 'CNY',
        total_balance: '110.00',
        granted_balance: '10.00',
        topped_up_balance: '100.00',
      },
    ],
  });
  assert.equal(cny.kind, 'credit');
  assert.equal(cny.providerId, 'deepseek');
  assert.equal(cny.currency, 'CNY');
  assert.equal(cny.remainingCredits, 110);
  assert.equal(cny.formattedRemaining, '¥110.00');

  const usd = parseDeepSeekBalance({
    is_available: true,
    balance_infos: [{ currency: 'USD', total_balance: '15.50' }],
  });
  assert.equal(usd.currency, 'USD');
  assert.equal(usd.remainingCredits, 15.5);
  assert.equal(usd.formattedRemaining, '$15.50');

  assert.throws(
    () => parseDeepSeekBalance({ is_available: true, balance_infos: [] }),
    (e) => (e as { code?: string }).code === 'SCHEMA_CHANGED',
  );
});

test('Devin parses protobuf status into daily/weekly windows and extracts apiKey', () => {
  const planStatusParts: number[] = [
    ...encodeVarint(14 * 8),
    ...encodeVarint(100),
    ...encodeVarint(15 * 8),
    ...encodeVarint(98),
    ...encodeVarint(17 * 8),
    ...encodeVarint(1789286400),
    ...encodeVarint(18 * 8),
    ...encodeVarint(1789286400),
  ];
  const planStatus = new Uint8Array(planStatusParts);
  const userStatus = encodeLengthDelimited(13, planStatus);
  const responseMsg = encodeLengthDelimited(1, userStatus);

  const raw = parseDevinUserStatus(responseMsg);
  const snapshot = parseDevinQuota(raw);

  assert.equal(snapshot.providerId, 'devin');
  assert.equal(snapshot.presentedWindow, '1week');
  assert.deepEqual(
    snapshot.windows.map((x) => [x.type, x.usedPercent, x.remainingPercent]),
    [
      ['1week', 2, 98],
      ['1day', 0, 100],
    ],
  );

  assert.throws(
    () => parseDevinQuota({}),
    (e) => (e as { code?: string }).code === 'SCHEMA_CHANGED',
  );

  assert.equal(
    extractDevinApiKey('devin_api_url = "https://api.devin.ai"\nwindsurf_api_key = "tok-123"\n'),
    'tok-123',
  );
});

test('Copilot parses premium interactions and rejects free tier with PLAN_REQUIRED', () => {
  const snapshot = parseCopilotQuota({
    copilot_plan: 'individual',
    quota_reset_date: '2026-10-01',
    quota_snapshots: {
      premium_interactions: {
        entitlement: 200,
        remaining: 191,
        percent_remaining: 95.5,
        has_quota: true,
      },
    },
  });

  assert.equal(snapshot.providerId, 'copilot');
  assert.equal(snapshot.presentedWindow, '1month');
  assert.equal(snapshot.windows.length, 1);
  assert.equal(snapshot.windows[0].type, '1month');
  assert.equal(snapshot.windows[0].remainingPercent, 95.5);
  assert.equal(snapshot.windows[0].usedPercent, 4.5);
  assert.equal(snapshot.windows[0].resetAt?.toISOString(), new Date('2026-10-01').toISOString());

  assert.throws(
    () =>
      parseCopilotQuota({
        copilot_plan: 'individual',
        quota_snapshots: {
          premium_interactions: { entitlement: 0, remaining: 0, has_quota: false },
        },
      }),
    (e) => (e as { code?: string }).code === 'PLAN_REQUIRED',
  );
});
