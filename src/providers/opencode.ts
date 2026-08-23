import { defineSecretProvider } from '../provider-definition.ts';
import { ProviderError } from '../provider-error.ts';
import type { QuotaSnapshot, QuotaWindow } from '../types';

interface OpenCodeGoUsageWindow {
  status?: string;
  percent?: number;
  resetsAt?: string;
}

interface OpenCodeGoUsageResponse {
  usage?: {
    rolling?: OpenCodeGoUsageWindow;
    weekly?: OpenCodeGoUsageWindow;
    monthly?: OpenCodeGoUsageWindow;
  };
}

function normalizeWindow(
  raw: OpenCodeGoUsageWindow | undefined,
  label: string,
): QuotaWindow | undefined {
  if (!raw || typeof raw.percent !== 'number' || !Number.isFinite(raw.percent)) return undefined;
  const usedPercent = Math.max(0, Math.min(100, raw.percent));
  const resetAt =
    typeof raw.resetsAt === 'string' && raw.resetsAt !== '' ? new Date(raw.resetsAt) : undefined;
  return {
    label,
    usedPercent,
    remainingPercent: 100 - usedPercent,
    resetAt: resetAt && !Number.isNaN(resetAt.getTime()) ? resetAt : undefined,
  };
}

export function parseOpenCodeGoUsage(body: OpenCodeGoUsageResponse): QuotaSnapshot {
  const windows = [
    normalizeWindow(body.usage?.rolling, '5h'),
    normalizeWindow(body.usage?.weekly, 'Week'),
    normalizeWindow(body.usage?.monthly, 'Month'),
  ].filter((value): value is QuotaWindow => Boolean(value));
  if (windows.length === 0) {
    throw new ProviderError(
      'SCHEMA_CHANGED',
      'No supported OpenCode Go usage windows',
      'Expected usage.rolling/weekly/monthly with percent.',
    );
  }
  return { kind: 'quota', id: 'opencode', label: 'OCG', windows };
}

export async function fetchOpenCodeGoUsage(apiKey: string): Promise<QuotaSnapshot> {
  const key = apiKey.trim();
  if (!key) throw new ProviderError('KEY_MISSING', 'OpenCode Go API Key required');

  const response = await fetch('https://opencode.ai/zen/go/v1/usage', {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${key}`,
      'User-Agent': 'lean-quota-monitor',
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return parseOpenCodeGoUsage((await response.json()) as OpenCodeGoUsageResponse);
}

export const openCodeProvider = defineSecretProvider({
  id: 'opencode',
  statusBarFallback: 'OCG',
  displayNameFallback: 'OpenCode Go',
  secret: {
    storageKey: 'leanQuotaMonitor.opencode.apiKey',
    pathId: 'opencode-go-usage-api',
    title: 'OpenCode Go API Key',
    setup: 'Set or replace the API Key from this Troubleshoot method.',
    inputPrompt: 'Required by the OpenCode Go usage API. Stored securely in VS Code SecretStorage.',
    inputPlaceholder: 'Paste OpenCode Go API Key',
    actionLabel: 'Set / Replace API Key',
    menuDescription: 'VS Code SecretStorage · required for Go usage',
    acquire: fetchOpenCodeGoUsage,
  },
});
