import assert from 'node:assert/strict';
import test from 'node:test';
import { parseClaudeQuota } from '../src/providers/anthropic.ts';
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

test('parses Gemini bucket ids from agy command_result', () => {
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

test('parses MiniMax model remains to quota windows', () => {
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
});

test('MiniMax reports SCHEMA_CHANGED when no valid model quota remains', () => {
  assert.throws(
    () => parseMiniMaxQuota({ base_resp: { status_code: 0 }, model_remains: [{}] }),
    (error) => {
      assert.equal((error as { code?: string }).code, 'SCHEMA_CHANGED');
      return true;
    },
  );
});

test('parses Kimi weekly and 5h quota by duration', () => {
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
});

test('Kimi quota reports SCHEMA_CHANGED without valid windows', () => {
  assert.throws(
    () => parseKimiQuota({ usage: { limit: '0', used: '0' }, limits: [] }),
    (error) => {
      assert.equal((error as { code?: string }).code, 'SCHEMA_CHANGED');
      return true;
    },
  );
});

test('parses Codex app-server 5h and weekly windows by duration', () => {
  const snapshot = parseCodexAppServerRateLimits({
    rateLimitsByLimitId: {
      codex: {
        limitId: 'codex',
        primary: { usedPercent: 20, windowDurationMins: 300, resetsAt: 1_787_000_000 },
        secondary: { usedPercent: 35, windowDurationMins: 10_080, resetsAt: 1_787_500_000 },
      },
    },
  });

  assert.deepEqual(
    snapshot.windows.map((x) => [x.type, x.remainingPercent]),
    [
      ['1week', 65],
      ['5hour', 80],
    ],
  );
});

test('parses Codex direct quota remaining percentage', () => {
  const snapshot = parseCodexDirectQuota({
    rate_limit: { primary_window: { used_percent: 10, limit_window_seconds: 604_800 } },
  });
  assert.deepEqual(
    snapshot.windows.map((x) => [x.type, x.remainingPercent]),
    [['1week', 90]],
  );
});

test('Codex direct quota rejects windows without a positive duration', () => {
  assert.throws(
    () => parseCodexDirectQuota({ rate_limit: { primary_window: { used_percent: 25 } } }),
    (error) => {
      assert.equal((error as { code?: string }).code, 'SCHEMA_CHANGED');
      return true;
    },
  );
});

test('parses Z.AI 5h and weekly token windows by type and duration', () => {
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
});

test('Z.AI unsupported token shapes report SCHEMA_CHANGED instead of guessing', () => {
  assert.throws(
    () =>
      parseZaiQuota({
        data: { limits: [{ type: 'POINTS_LIMIT', percentage: 10 }] },
      }),
    (error) => {
      assert.equal((error as { code?: string }).code, 'SCHEMA_CHANGED');
      return true;
    },
  );
});

test('parses OpenRouter remaining credits', () => {
  const snapshot = parseOpenRouterCredits({
    data: { total_credits: 100.5, total_usage: 25.75 },
  });
  assert.equal(snapshot.kind, 'credit');
  assert.equal(snapshot.remainingCredits, 74.75);
  assert.equal(snapshot.totalCredits, 100.5);
  assert.equal(snapshot.usedCredits, 25.75);
});

test('OpenRouter rejects invalid numeric fields with SCHEMA_CHANGED', () => {
  assert.throws(
    () => parseOpenRouterCredits({ data: {} }),
    (error) => {
      assert.equal((error as { code?: string }).code, 'SCHEMA_CHANGED');
      return true;
    },
  );
});

test('parses OpenCode Go rolling, weekly, and monthly usage windows', () => {
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
  assert.equal(
    snapshot.windows[0].resetAt?.toISOString(),
    new Date('2026-09-01T00:00:00.000Z').toISOString(),
  );
  assert.equal(
    snapshot.windows[1].resetAt?.toISOString(),
    new Date('2026-08-28T00:00:00.000Z').toISOString(),
  );
  assert.equal(
    snapshot.windows[2].resetAt?.toISOString(),
    new Date('2026-08-24T12:00:00.000Z').toISOString(),
  );
});

test('OpenCode Go response without valid windows reports SCHEMA_CHANGED', () => {
  assert.throws(
    () => parseOpenCodeGoUsage({ usage: { rolling: {} } }),
    (error) => {
      assert.equal((error as { code?: string }).code, 'SCHEMA_CHANGED');
      return true;
    },
  );
});

test('parses Claude OAuth usage windows', () => {
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

test('parses DeepSeek CNY balance to credit snapshot with ¥ format', () => {
  const snapshot = parseDeepSeekBalance({
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

  assert.equal(snapshot.kind, 'credit');
  assert.equal(snapshot.providerId, 'deepseek');
  assert.equal(snapshot.currency, 'CNY');
  assert.equal(snapshot.remainingCredits, 110);
  assert.equal(snapshot.formattedRemaining, '¥110.00');
});

test('parses DeepSeek USD balance to credit snapshot with $ format', () => {
  const snapshot = parseDeepSeekBalance({
    is_available: true,
    balance_infos: [
      {
        currency: 'USD',
        total_balance: '15.50',
      },
    ],
  });

  assert.equal(snapshot.kind, 'credit');
  assert.equal(snapshot.currency, 'USD');
  assert.equal(snapshot.remainingCredits, 15.5);
  assert.equal(snapshot.formattedRemaining, '$15.50');
});

test('DeepSeek response without valid balance reports SCHEMA_CHANGED', () => {
  assert.throws(
    () => parseDeepSeekBalance({ is_available: true, balance_infos: [] }),
    (error) => {
      assert.equal((error as { code?: string }).code, 'SCHEMA_CHANGED');
      return true;
    },
  );
});

test('parses Devin user status protobuf into weekly and daily quota windows', () => {
  // Construct PlanStatus protobuf message
  // Field 14 (dailyPercent) = 100
  // Field 15 (weeklyPercent) = 98
  // Field 17 (dailyResetAt) = 1789286400
  // Field 18 (weeklyResetAt) = 1789286400
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

  // Wrap in UserStatus (Field 13 = planStatus)
  const userStatus = encodeLengthDelimited(13, planStatus);

  // Wrap in GetUserStatusResponse (Field 1 = userStatus)
  const responseMsg = encodeLengthDelimited(1, userStatus);

  const raw = parseDevinUserStatus(responseMsg);
  const snapshot = parseDevinQuota(raw);

  assert.equal(snapshot.kind, 'quota');
  assert.equal(snapshot.providerId, 'devin');
  assert.equal(snapshot.presentedWindow, '1week');
  assert.deepEqual(
    snapshot.windows.map((x) => [x.type, x.usedPercent, x.remainingPercent]),
    [
      ['1week', 2, 98],
      ['1day', 0, 100],
    ],
  );
  assert.equal(
    snapshot.windows[0].resetAt?.toISOString(),
    new Date(1789286400 * 1000).toISOString(),
  );
  assert.equal(
    snapshot.windows[1].resetAt?.toISOString(),
    new Date(1789286400 * 1000).toISOString(),
  );
});

test('Devin response without valid quota windows reports SCHEMA_CHANGED', () => {
  assert.throws(
    () => parseDevinQuota({}),
    (error) => {
      assert.equal((error as { code?: string }).code, 'SCHEMA_CHANGED');
      return true;
    },
  );
});

test('extractDevinApiKey extracts windsurf_api_key from credentials.toml', () => {
  const content = 'devin_api_url = "https://api.devin.ai"\nwindsurf_api_key = "test-token-123"\n';
  assert.equal(extractDevinApiKey(content), 'test-token-123');
  assert.equal(extractDevinApiKey('other = "value"'), undefined);
});
