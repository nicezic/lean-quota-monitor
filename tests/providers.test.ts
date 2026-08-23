import assert from 'node:assert/strict';
import test from 'node:test';
import { parseClaudeQuota } from '../src/providers/anthropic.ts';
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
    parseAgyQuota(line).map((x) => [x.label, x.remainingPercent]),
    [
      ['Week', 80],
      ['5h', 90],
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
    snapshot.windows.map((x) => [x.label, x.remainingPercent]),
    [
      ['5h', 76],
      ['Week', 71],
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
    snapshot.windows.map((x) => [x.label, Math.round(x.remainingPercent)]),
    [
      ['5h', 31],
      ['Week', 90],
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
    snapshot.windows.map((x) => [x.label, x.remainingPercent]),
    [
      ['5h', 80],
      ['Week', 65],
    ],
  );
});

test('parses Codex direct quota remaining percentage', () => {
  const snapshot = parseCodexDirectQuota({
    rate_limit: { primary_window: { used_percent: 10, limit_window_seconds: 604_800 } },
  });
  assert.deepEqual(
    snapshot.windows.map((x) => [x.label, x.remainingPercent]),
    [['Week', 90]],
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
    snapshot.windows.map((x) => [x.label, x.remainingPercent]),
    [
      ['Week', 48],
      ['5h', 59.5],
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
      rolling: { status: 'ok', percent: 25, resetsAt: '2026-08-24T12:00:00.000Z' },
      weekly: { status: 'ok', percent: 52.5, resetsAt: '2026-08-28T00:00:00.000Z' },
      monthly: { status: 'rate-limited', percent: 100, resetsAt: '2026-09-01T00:00:00.000Z' },
    },
  });

  assert.equal(snapshot.kind, 'quota');
  assert.deepEqual(
    snapshot.windows.map((x) => [x.label, x.usedPercent, x.remainingPercent]),
    [
      ['5h', 25, 75],
      ['Week', 52.5, 47.5],
      ['Month', 100, 0],
    ],
  );
  assert.equal(
    snapshot.windows[0].resetAt?.toISOString(),
    new Date('2026-08-24T12:00:00.000Z').toISOString(),
  );
});

test('OpenCode Go response without valid windows reports SCHEMA_CHANGED', () => {
  assert.throws(
    () => parseOpenCodeGoUsage({ usage: { rolling: { status: 'ok' } } }),
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
    snapshot.windows.map((x) => [x.label, x.remainingPercent]),
    [
      ['5h', 77],
      ['Week', 59],
    ],
  );
  assert.equal(snapshot.windows[0].resetAt?.toISOString(), '2026-08-18T15:00:00.000Z');
});
