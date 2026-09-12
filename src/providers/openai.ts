import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import process from 'node:process';
import type { BuiltInProviderDefinition } from '../provider-definition.ts';
import { hasErrorCode, ProviderError } from '../provider-error.ts';
import {
  pickStatusWindow,
  type QuotaSnapshot,
  type QuotaWindow,
  type WindowType,
} from '../types.ts';

interface CodexAuthFile {
  tokens?: {
    access_token?: string;
    account_id?: string;
  };
}

interface CodexWindow {
  used_percent?: number;
  limit_window_seconds?: number;
  reset_at?: number;
}

interface CodexAppServerWindow {
  usedPercent?: number;
  windowDurationMins?: number;
  resetsAt?: number;
}

interface CodexAppServerRateLimits {
  limitId?: string;
  primary?: CodexAppServerWindow | null;
  secondary?: CodexAppServerWindow | null;
}

interface CodexAppServerRateLimitsResult {
  rateLimits?: CodexAppServerRateLimits | null;
  rateLimitsByLimitId?: Record<string, CodexAppServerRateLimits | undefined>;
}

interface CodexUsageResponse {
  rate_limit?: {
    primary_window?: CodexWindow;
    secondary_window?: CodexWindow;
  };
}

function typeForMinutes(minutes: number): WindowType | undefined {
  if (minutes === 300) return '5hour';
  if (minutes === 10_080) return '1week';
  return undefined;
}

function normalizeDirectWindow(raw: CodexWindow | undefined): QuotaWindow | undefined {
  if (!raw || !Number.isFinite(raw.used_percent)) return undefined;
  const usedPercent = Math.max(0, Math.min(100, Number(raw.used_percent)));
  const seconds = Number(raw.limit_window_seconds);
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  const type = typeForMinutes(Math.round(seconds / 60));
  if (!type) return undefined;
  const resetSeconds = Number(raw.reset_at);
  return {
    type,
    usedPercent,
    remainingPercent: 100 - usedPercent,
    resetAt:
      Number.isFinite(resetSeconds) && resetSeconds > 0 ? new Date(resetSeconds * 1000) : undefined,
  };
}

function normalizeAppServerWindow(
  raw: CodexAppServerWindow | null | undefined,
): QuotaWindow | undefined {
  if (!raw || !Number.isFinite(raw.usedPercent) || !Number.isFinite(raw.windowDurationMins)) {
    return undefined;
  }
  const usedPercent = Math.max(0, Math.min(100, Number(raw.usedPercent)));
  const minutes = Number(raw.windowDurationMins);
  if (minutes <= 0) return undefined;
  const type = typeForMinutes(minutes);
  if (!type) return undefined;
  return {
    type,
    usedPercent,
    remainingPercent: 100 - usedPercent,
    resetAt: Number.isFinite(raw.resetsAt) ? new Date(Number(raw.resetsAt) * 1000) : undefined,
  };
}

export function parseCodexAppServerRateLimits(
  result: CodexAppServerRateLimitsResult,
): QuotaSnapshot {
  const rateLimits =
    result.rateLimitsByLimitId?.codex ??
    (result.rateLimits?.limitId === 'codex' ? result.rateLimits : undefined);
  if (!rateLimits) {
    throw new ProviderError('SCHEMA_CHANGED', 'No Codex app-server rate limits');
  }

  const windows = [
    normalizeAppServerWindow(rateLimits.primary),
    normalizeAppServerWindow(rateLimits.secondary),
  ].filter((value): value is QuotaWindow => Boolean(value));
  if (windows.length === 0) {
    throw new ProviderError('SCHEMA_CHANGED', 'No supported Codex app-server quota windows');
  }
  const statusType = pickStatusWindow(windows, '1week');
  return { kind: 'quota', providerId: 'openai', statusType, windows };
}

export function parseCodexDirectQuota(body: CodexUsageResponse): QuotaSnapshot {
  const windows = [
    normalizeDirectWindow(body.rate_limit?.primary_window),
    normalizeDirectWindow(body.rate_limit?.secondary_window),
  ].filter((value): value is QuotaWindow => Boolean(value));
  if (windows.length === 0) {
    throw new ProviderError('SCHEMA_CHANGED', 'No supported Codex quota windows');
  }
  const statusType = pickStatusWindow(windows, '1week');
  return { kind: 'quota', providerId: 'openai', statusType, windows };
}

export async function fetchOpenAIQuota(): Promise<QuotaSnapshot> {
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  let rawAuth: string;
  try {
    rawAuth = await fs.readFile(path.join(codexHome, 'auth.json'), 'utf8');
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) {
      throw new ProviderError('AUTH_REQUIRED', 'Codex login required');
    }
    throw error;
  }
  const auth = JSON.parse(rawAuth) as CodexAuthFile;
  const accessToken = auth.tokens?.access_token;
  if (!accessToken) throw new ProviderError('AUTH_REQUIRED', 'Codex login required');

  const response = await fetch('https://chatgpt.com/backend-api/wham/usage', {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
      ...(auth.tokens?.account_id ? { 'chatgpt-account-id': auth.tokens.account_id } : {}),
      'User-Agent': 'lean-quota-monitor',
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  return parseCodexDirectQuota((await response.json()) as CodexUsageResponse);
}

export function fetchOpenAIQuotaFromAppServer(): Promise<QuotaSnapshot> {
  return new Promise((resolve, reject) => {
    const child = spawn('codex', ['app-server', '--listen', 'stdio://'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let settled = false;
    let buffer = '';

    const finish = (error?: Error, snapshot?: QuotaSnapshot) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdin.end();
      child.kill();
      if (error) reject(error);
      else if (snapshot) resolve(snapshot);
      else reject(new Error('Codex app-server returned no snapshot'));
    };

    const timer = setTimeout(() => finish(new Error('Codex app-server timeout')), 15_000);

    child.on('error', (error) =>
      finish(
        hasErrorCode(error, 'ENOENT')
          ? new ProviderError('CLI_NOT_FOUND', 'Codex CLI not found')
          : error,
      ),
    );
    child.on('close', (code) => {
      if (!settled)
        finish(new Error(`Codex app-server exited before response (${code ?? 'unknown'})`));
    });
    child.stderr.on('data', () => undefined);

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      for (;;) {
        const newline = buffer.indexOf('\n');
        if (newline < 0) break;
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;

        let message: {
          id?: number;
          result?: unknown;
          error?: { message?: string };
        };
        try {
          message = JSON.parse(line) as typeof message;
        } catch {
          continue;
        }

        if (message.id === 0) {
          if (message.error) {
            finish(new Error(message.error.message ?? 'Codex app-server initialization failed'));
            return;
          }
          child.stdin.write(`${JSON.stringify({ method: 'initialized', params: {} })}\n`);
          child.stdin.write(`${JSON.stringify({ method: 'account/rateLimits/read', id: 1 })}\n`);
          continue;
        }

        if (message.id === 1) {
          if (message.error) {
            finish(new Error(message.error.message ?? 'Codex app-server rate limits failed'));
            return;
          }
          try {
            finish(
              undefined,
              parseCodexAppServerRateLimits(message.result as CodexAppServerRateLimitsResult),
            );
          } catch (error) {
            finish(error instanceof Error ? error : new Error(String(error)));
          }
          return;
        }
      }
    });

    child.stdin.write(
      `${JSON.stringify({
        method: 'initialize',
        id: 0,
        params: {
          clientInfo: {
            name: 'lean_quota_monitor',
            title: 'Lean Quota Monitor',
            version: '0.0.16',
          },
        },
      })}\n`,
    );
  });
}

export const openAIProvider: BuiltInProviderDefinition = {
  id: 'openai',
  statusBarName: 'GPT',
  providerName: 'Codex',
  snapshotPlan() {
    const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
    return {
      kind: 'available',
      paths: [
        {
          id: 'codex-direct-api',
          acquire: fetchOpenAIQuota,
          troubleshoot: {
            title: 'Codex login',
            setup: 'Install Codex CLI → codex login',
            lookup: { kind: 'file', path: path.join(codexHome, 'auth.json') },
          },
        },
        {
          id: 'codex-app-server',
          acquire: fetchOpenAIQuotaFromAppServer,
          troubleshoot: {
            title: 'Codex app-server',
            setup: 'Install Codex CLI → codex login → codex app-server (used automatically)',
            lookup: { kind: 'executable', command: 'codex' },
          },
        },
      ],
    };
  },
};
