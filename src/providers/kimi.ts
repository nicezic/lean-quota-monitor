import { defineSecretProvider } from '../provider-definition.ts';
import { ProviderError } from '../provider-error.ts';
import type { QuotaSnapshot, QuotaWindow } from '../types';

interface KimiUsageDetail {
  limit?: string | number;
  used?: string | number;
  remaining?: string | number;
  resetTime?: string;
}

interface KimiUsageLimit {
  window?: {
    duration?: number;
    timeUnit?: string;
  };
  detail?: KimiUsageDetail;
}

interface KimiUsageResponse {
  usage?: KimiUsageDetail;
  limits?: KimiUsageLimit[];
}

function finiteNumeric(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeUsage(
  detail: KimiUsageDetail | undefined,
  label: string,
): QuotaWindow | undefined {
  if (!detail) return undefined;
  const limit = finiteNumeric(detail.limit);
  const used = finiteNumeric(detail.used);
  const remaining = finiteNumeric(detail.remaining);
  if (limit === undefined || limit <= 0) return undefined;

  const rawUsedPercent =
    used !== undefined
      ? (used / limit) * 100
      : remaining !== undefined
        ? ((limit - remaining) / limit) * 100
        : Number.NaN;
  if (!Number.isFinite(rawUsedPercent)) return undefined;

  const usedPercent = Math.max(0, Math.min(100, rawUsedPercent));
  const resetAt = detail.resetTime ? new Date(detail.resetTime) : undefined;

  return {
    label,
    usedPercent,
    remainingPercent: 100 - usedPercent,
    resetAt: resetAt && !Number.isNaN(resetAt.getTime()) ? resetAt : undefined,
  };
}

export function parseKimiQuota(body: KimiUsageResponse): QuotaSnapshot {
  const weekly = normalizeUsage(body.usage, 'Week');
  const fiveHour = normalizeUsage(
    body.limits?.find(
      ({ window }) => window?.duration === 300 && window.timeUnit === 'TIME_UNIT_MINUTE',
    )?.detail,
    '5h',
  );
  const windows = [fiveHour, weekly].filter((value): value is QuotaWindow => Boolean(value));
  if (windows.length === 0) {
    throw new ProviderError('SCHEMA_CHANGED', 'Unsupported Kimi quota response');
  }

  return { kind: 'quota', id: 'kimi', label: 'KIMI', windows };
}

export async function fetchKimiQuota(apiKey: string): Promise<QuotaSnapshot> {
  const key = apiKey.trim();
  if (!key) throw new ProviderError('KEY_MISSING', 'Kimi Code API Key required');

  const response = await fetch('https://api.kimi.com/coding/v1/usages', {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${key}`,
      'User-Agent': 'lean-quota-monitor',
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return parseKimiQuota((await response.json()) as KimiUsageResponse);
}

export const kimiProvider = defineSecretProvider({
  id: 'kimi',
  statusBarFallback: 'KIMI',
  displayNameFallback: 'Kimi',
  secret: {
    storageKey: 'leanQuotaMonitor.kimi.apiKey',
    pathId: 'kimi-api-key',
    title: 'Kimi Code API Key',
    setup: 'Set or replace the API Key from this Troubleshoot method.',
    inputPrompt: 'Stored securely in VS Code SecretStorage.',
    inputPlaceholder: 'Paste Kimi Code API Key',
    actionLabel: 'Set / Replace API Key',
    menuDescription: 'VS Code SecretStorage · Kimi Code quota',
    acquire: fetchKimiQuota,
  },
});
