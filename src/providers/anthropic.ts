import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import process from 'node:process';
import type { BuiltInProviderDefinition } from '../provider-definition.ts';
import { hasErrorCode, ProviderError } from '../provider-error.ts';
import { pickStatusWindow, type QuotaSnapshot, type QuotaWindow } from '../types.ts';

interface ClaudeCredentialFile {
  claudeAiOauth?: {
    accessToken?: string;
  };
}

interface ClaudeUsageWindow {
  utilization?: number;
  resets_at?: string;
}

interface ClaudeUsageResponse {
  five_hour?: ClaudeUsageWindow;
  seven_day?: ClaudeUsageWindow;
}

function normalizeWindow(
  raw: ClaudeUsageWindow | undefined,
  type: '5hour' | '1week',
): QuotaWindow | undefined {
  if (!raw || !Number.isFinite(raw.utilization)) return undefined;
  const usedPercent = Number(raw.utilization);
  if (usedPercent < 0 || usedPercent > 100) return undefined;
  const resetAt = raw.resets_at ? new Date(raw.resets_at) : undefined;
  return {
    type,
    usedPercent,
    remainingPercent: 100 - usedPercent,
    resetAt: resetAt && Number.isFinite(resetAt.getTime()) ? resetAt : undefined,
  };
}

export function parseClaudeQuota(body: ClaudeUsageResponse): QuotaSnapshot {
  const windows = [
    normalizeWindow(body.five_hour, '5hour'),
    normalizeWindow(body.seven_day, '1week'),
  ].filter((value): value is QuotaWindow => Boolean(value));
  if (windows.length === 0) {
    throw new ProviderError('SCHEMA_CHANGED', 'No supported Claude quota windows');
  }
  const statusType = pickStatusWindow(windows, '1week');
  return { kind: 'quota', providerId: 'anthropic', statusType, windows };
}

export async function fetchAnthropicQuota(): Promise<QuotaSnapshot> {
  const claudeHome = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  let rawCredentials: string;
  try {
    rawCredentials = await fs.readFile(path.join(claudeHome, '.credentials.json'), 'utf8');
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) {
      throw new ProviderError('AUTH_REQUIRED', 'Claude Code login required');
    }
    throw error;
  }
  const credentials = JSON.parse(rawCredentials) as ClaudeCredentialFile;
  const accessToken = credentials.claudeAiOauth?.accessToken;
  if (!accessToken) throw new ProviderError('AUTH_REQUIRED', 'Claude Code login required');

  const response = await fetch('https://api.anthropic.com/api/oauth/usage', {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'anthropic-beta': 'oauth-2025-04-20',
      'User-Agent': 'lean-quota-monitor',
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  return parseClaudeQuota((await response.json()) as ClaudeUsageResponse);
}

const DARWIN_UNSUPPORTED =
  'Claude quota acquisition is not supported on macOS because Claude Code stores credentials in macOS Keychain.';

export const anthropicProvider: BuiltInProviderDefinition = {
  id: 'anthropic',
  statusBarName: 'CLA',
  providerName: 'Claude',
  snapshotPlan({ platform }) {
    if (platform === 'darwin') {
      return {
        kind: 'unsupported',
        error: new Error(DARWIN_UNSUPPORTED),
        troubleshoot: {
          title: 'Claude Code on macOS',
          setup:
            'Not supported yet: Claude Code subscription credentials are stored in macOS Keychain.',
          lookup: { kind: 'executable', command: 'claude' },
        },
      };
    }

    const claudeHome = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
    return {
      kind: 'available',
      paths: [
        {
          id: 'claude-oauth-api',
          acquire: fetchAnthropicQuota,
          troubleshoot: {
            title: 'Claude Code login',
            setup:
              platform === 'win32'
                ? 'Install Claude Code → claude → /login'
                : 'Install Claude Code → login',
            lookup: { kind: 'file', path: path.join(claudeHome, '.credentials.json') },
          },
        },
      ],
    };
  },
};
