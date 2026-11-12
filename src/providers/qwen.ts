import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { BuiltInProviderDefinition } from '../provider-definition.ts';
import { hasErrorCode, ProviderError } from '../provider-error.ts';
import {
  pickPresentedWindow,
  type QuotaSnapshot,
  type QuotaWindow,
  type WindowType,
} from '../types.ts';

const execFileAsync = promisify(execFile);

// The Bailian CLI owns the console credential and the region: `bl auth login --console`
// saves the console site (domestic / international), and usage commands follow it.
async function blUsageJson(
  command: 'token-plan' | 'coding-plan',
): Promise<Record<string, unknown>> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync('bl', ['usage', command, '--output', 'json'], {
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    }));
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) {
      throw new ProviderError('CLI_NOT_FOUND', 'Bailian CLI (bl) not found in PATH');
    }
    const exitCode = (error as { code?: unknown }).code;
    if (exitCode === 3) {
      throw new ProviderError('AUTH_REQUIRED', 'bl auth login --console required');
    }
    throw new Error(
      typeof exitCode === 'number' ? `bl usage exited with code ${exitCode}` : 'bl usage failed',
    );
  }
  let body: unknown;
  try {
    body = JSON.parse(stdout);
  } catch {
    throw new ProviderError('SCHEMA_CHANGED', 'Unexpected bl usage JSON output');
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ProviderError('SCHEMA_CHANGED', 'Unexpected bl usage JSON output');
  }
  return body as Record<string, unknown>;
}

// Both plans report usage as a 0..1 ratio plus an epoch-millisecond reset time.
// Out-of-range ratios invalidate the window (fail closed); no clamping is applied.
function quotaWindow(type: WindowType, ratio: unknown, reset: unknown): QuotaWindow | undefined {
  if (typeof ratio !== 'number' || !Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
    return undefined;
  }
  const usedPercent = ratio * 100;
  const resetAt = typeof reset === 'number' && Number.isFinite(reset) ? new Date(reset) : undefined;
  return {
    type,
    usedPercent,
    remainingPercent: 100 - usedPercent,
    resetAt: resetAt && Number.isFinite(resetAt.getTime()) ? resetAt : undefined,
  };
}

const TOKEN_PLAN_WINDOWS: readonly (readonly [string, WindowType])[] = [
  ['per5Hour', '5hour'],
  ['per1Day', '1day'],
  ['per1Week', '1week'],
  ['per1Month', '1month'],
];

export function parseQwenTokenPlanQuota(body: Record<string, unknown>): QuotaSnapshot {
  const windows: QuotaWindow[] = [];
  for (const [prefix, type] of TOKEN_PLAN_WINDOWS) {
    const window = quotaWindow(type, body[`${prefix}Percentage`], body[`${prefix}ResetTime`]);
    if (window) windows.push(window);
  }
  // hasQuotaData=false also covers "may be unlimited" responses, so it is not a
  // subscription signal; no valid window fails closed like the other quota providers.
  if (windows.length === 0) {
    throw new ProviderError('SCHEMA_CHANGED', 'No supported Qwen Token Plan quota windows');
  }
  const presentedWindow = pickPresentedWindow(windows, '1month');
  return { kind: 'quota', providerId: 'qwen', presentedWindow, windows };
}

const CODING_PLAN_WINDOWS: readonly (readonly [string, WindowType])[] = [
  ['per5Hour', '5hour'],
  ['perWeek', '1week'],
  ['perBillMonth', '1month'],
];

export function parseQwenCodingPlanQuota(body: Record<string, unknown>): QuotaSnapshot {
  // CLI contract: an empty object means no VALID Coding Plan instance was found.
  if (Object.keys(body).length === 0) {
    throw new ProviderError('PLAN_REQUIRED', 'No active Qwen Coding Plan subscription');
  }
  const windows: QuotaWindow[] = [];
  for (const [key, type] of CODING_PLAN_WINDOWS) {
    const source = body[key];
    if (typeof source !== 'object' || source === null) continue;
    const { percentage, resetTime } = source as { percentage?: unknown; resetTime?: unknown };
    const window = quotaWindow(type, percentage, resetTime);
    if (window) windows.push(window);
  }
  if (windows.length === 0) {
    throw new ProviderError('SCHEMA_CHANGED', 'No supported Qwen Coding Plan quota windows');
  }
  const presentedWindow = pickPresentedWindow(windows, '1month');
  return { kind: 'quota', providerId: 'qwenCoding', presentedWindow, windows };
}

export async function fetchQwenTokenPlanQuota(): Promise<QuotaSnapshot> {
  return parseQwenTokenPlanQuota(await blUsageJson('token-plan'));
}

export async function fetchQwenCodingPlanQuota(): Promise<QuotaSnapshot> {
  return parseQwenCodingPlanQuota(await blUsageJson('coding-plan'));
}

const CONSOLE_LOGIN_SETUP =
  'Install Bailian CLI → bl auth login --console (global account: --console-site international)';

export const qwenProvider: BuiltInProviderDefinition = {
  id: 'qwen',
  statusBarName: 'QWEN',
  providerName: 'Qwen Token Plan',
  snapshotPlan() {
    return {
      kind: 'available',
      paths: [
        {
          id: 'qwen-token-plan-cli',
          acquire: fetchQwenTokenPlanQuota,
          troubleshoot: {
            title: 'Bailian CLI (bl)',
            setup: `${CONSOLE_LOGIN_SETUP} → bl usage token-plan`,
            lookup: { kind: 'executable', command: 'bl' },
          },
        },
      ],
    };
  },
};

export const qwenCodingProvider: BuiltInProviderDefinition = {
  id: 'qwenCoding',
  statusBarName: 'QWC',
  providerName: 'Qwen Coding Plan',
  snapshotPlan() {
    return {
      kind: 'available',
      paths: [
        {
          id: 'qwen-coding-plan-cli',
          acquire: fetchQwenCodingPlanQuota,
          troubleshoot: {
            title: 'Bailian CLI (bl)',
            setup: `${CONSOLE_LOGIN_SETUP} → bl usage coding-plan`,
            lookup: { kind: 'executable', command: 'bl' },
          },
        },
      ],
    };
  },
};
