import { defineSecretProvider } from '../provider-definition.ts';
import { ProviderError } from '../provider-error.ts';
import {
  pickStatusWindow,
  type QuotaSnapshot,
  type QuotaWindow,
  type WindowType,
} from '../types.ts';

interface ZaiQuotaLimit {
  type?: string;
  unit?: number | string;
  number?: number | string;
  percentage?: number | string;
  nextResetTime?: number | string;
}

interface ZaiQuotaResponse {
  data?: {
    limits?: ZaiQuotaLimit[];
  };
}

function finiteNumeric(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeWindow(limit: ZaiQuotaLimit): QuotaWindow | undefined {
  if (limit.type !== 'TOKENS_LIMIT') return undefined;

  const unit = finiteNumeric(limit.unit);
  const number = finiteNumeric(limit.number);
  const usedPercent = finiteNumeric(limit.percentage);
  if (usedPercent === undefined || usedPercent < 0 || usedPercent > 100) return undefined;

  let type: WindowType | undefined;
  if (unit === 3 && number === 5) type = '5hour';
  if (unit === 6 && number === 1) type = '1week';
  if (!type) return undefined;

  const resetMs = finiteNumeric(limit.nextResetTime);
  return {
    type,
    usedPercent,
    remainingPercent: 100 - usedPercent,
    resetAt: resetMs !== undefined ? new Date(resetMs) : undefined,
  };
}

export function parseZaiQuota(body: ZaiQuotaResponse): QuotaSnapshot {
  const windows = (body.data?.limits ?? [])
    .map(normalizeWindow)
    .filter((value): value is QuotaWindow => Boolean(value));

  if (windows.length === 0) {
    throw new ProviderError(
      'SCHEMA_CHANGED',
      'No supported Z.AI quota windows',
      'Expected TOKENS_LIMIT windows for 5h and/or Week.',
    );
  }

  const statusType = pickStatusWindow(windows, '1week');
  return {
    kind: 'quota',
    providerId: 'zai',
    statusType,
    windows,
  };
}

export async function fetchZaiQuota(apiKey: string): Promise<QuotaSnapshot> {
  const key = apiKey.trim();
  if (!key) throw new ProviderError('KEY_MISSING', 'Z.AI API Key required');

  const response = await fetch('https://api.z.ai/api/monitor/usage/quota/limit', {
    headers: {
      Accept: 'application/json',
      'Accept-Language': 'en-US,en',
      Authorization: key,
      'Content-Type': 'application/json',
      'User-Agent': 'lean-quota-monitor',
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return parseZaiQuota((await response.json()) as ZaiQuotaResponse);
}

export const zaiProvider = defineSecretProvider({
  id: 'zai',
  statusBarName: 'GLM',
  providerName: 'Z.AI / GLM',
  secret: {
    storageKey: 'leanQuotaMonitor.zai.apiKey',
    pathId: 'zai-quota-api',
    title: 'Z.AI Coding Plan API Key',
    setup: 'Set or replace the API Key from this Troubleshoot method.',
    inputPrompt: 'Stored securely in VS Code SecretStorage.',
    inputPlaceholder: 'Paste Z.AI API Key',
    actionLabel: 'Set / Replace API Key',
    menuDescription: 'VS Code SecretStorage · GLM Coding Plan quota',
    acquire: fetchZaiQuota,
  },
});
