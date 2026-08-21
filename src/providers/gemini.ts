import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { BuiltInProviderDefinition } from '../provider-definition.ts';
import { hasErrorCode, ProviderError } from '../provider-error.ts';
import type { QuotaSnapshot, QuotaWindow } from '../types';

const execFileAsync = promisify(execFile);

interface AgyBucket {
  id?: string;
  window?: string;
  remaining_fraction?: number;
  reset_time?: string;
}

interface AgyGroup {
  name?: string;
  buckets?: AgyBucket[];
}

interface AgyCommandResult {
  event?: string;
  command?: { data?: { groups?: AgyGroup[] } };
}

export function parseAgyQuota(output: string): QuotaWindow[] {
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim().startsWith('{')) continue;
    let event: AgyCommandResult;
    try {
      event = JSON.parse(line) as AgyCommandResult;
    } catch {
      continue;
    }
    if (event.event !== 'command_result') continue;
    const group = event.command?.data?.groups?.find((item) => item.name === 'Gemini Models');
    if (!group?.buckets) continue;
    const windows: QuotaWindow[] = [];
    for (const bucket of group.buckets) {
      if (bucket.id !== 'gemini-5h' && bucket.id !== 'gemini-weekly') continue;
      const remainingFraction = bucket.remaining_fraction;
      if (
        typeof remainingFraction !== 'number' ||
        !Number.isFinite(remainingFraction) ||
        remainingFraction < 0 ||
        remainingFraction > 1
      ) {
        continue;
      }
      const remainingPercent = remainingFraction * 100;
      const resetAt = bucket.reset_time ? new Date(bucket.reset_time) : undefined;
      windows.push({
        label: bucket.id === 'gemini-5h' ? '5h' : 'Week',
        usedPercent: 100 - remainingPercent,
        remainingPercent,
        resetAt: resetAt && Number.isFinite(resetAt.getTime()) ? resetAt : undefined,
      });
    }
    return windows;
  }
  return [];
}

export async function fetchGeminiQuota(): Promise<QuotaSnapshot> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(
      'agy',
      ['-p', '/quota', '--output-format', 'stream-json', '--print-timeout', '30s'],
      {
        timeout: 45_000,
        maxBuffer: 2 * 1024 * 1024,
      },
    ));
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) {
      throw new ProviderError('CLI_NOT_FOUND', 'AGY CLI not found');
    }
    throw error;
  }
  const windows = parseAgyQuota(stdout);
  if (windows.length === 0) {
    throw new ProviderError('SCHEMA_CHANGED', 'No supported Gemini quota buckets');
  }
  return { kind: 'quota', id: 'gemini', label: 'Gem', windows };
}

export const geminiProvider: BuiltInProviderDefinition = {
  id: 'gemini',
  statusBarFallback: 'AGY',
  displayNameFallback: 'Gemini',
  snapshotPlan({ platform }) {
    return {
      kind: 'available',
      paths: [
        {
          id: 'agy-cli',
          acquire: fetchGeminiQuota,
          troubleshoot: {
            title: 'AGY CLI',
            setup:
              platform === 'linux'
                ? "Install AGY CLI → login → agy -p '/quota'"
                : "Install AGY CLI → agy → Google Sign-In → agy -p '/quota'",
            lookup: { kind: 'executable', command: 'agy' },
          },
        },
      ],
    };
  },
};
