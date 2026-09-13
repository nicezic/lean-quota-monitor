import { defineSecretProvider } from '../provider-definition.ts';
import { ProviderError } from '../provider-error.ts';
import { pickPresentedWindow, type QuotaSnapshot, type QuotaWindow } from '../types.ts';

interface MiniMaxModel {
  current_interval_remaining_percent?: number;
  current_weekly_remaining_percent?: number;
  end_time?: number;
  weekly_end_time?: number;
}

interface MiniMaxResponse {
  model_remains?: MiniMaxModel[];
  base_resp?: { status_code?: number; status_msg?: string };
}

function aggregate(models: MiniMaxModel[], kind: 'interval' | 'weekly'): QuotaWindow | undefined {
  const remainingKey =
    kind === 'interval' ? 'current_interval_remaining_percent' : 'current_weekly_remaining_percent';
  const endKey = kind === 'interval' ? 'end_time' : 'weekly_end_time';
  let selectedRemaining: number | undefined;
  let selectedEndTime: number | undefined;
  let selectedUsed = -1;

  for (const model of models) {
    const remaining = model[remainingKey];
    if (
      typeof remaining !== 'number' ||
      !Number.isFinite(remaining) ||
      remaining < 0 ||
      remaining > 100
    ) {
      continue;
    }
    const used = 100 - remaining;
    if (used > selectedUsed) {
      selectedRemaining = remaining;
      const rawEndTime = model[endKey];
      selectedEndTime =
        typeof rawEndTime === 'number' && Number.isFinite(rawEndTime) && rawEndTime > 0
          ? rawEndTime
          : undefined;
      selectedUsed = used;
    }
  }

  if (selectedRemaining === undefined) return undefined;
  return {
    type: kind === 'interval' ? '5hour' : '1week',
    usedPercent: 100 - selectedRemaining,
    remainingPercent: selectedRemaining,
    resetAt: selectedEndTime !== undefined ? new Date(selectedEndTime) : undefined,
  };
}

export function parseMiniMaxQuota(body: MiniMaxResponse): QuotaSnapshot {
  if (body.base_resp?.status_code && body.base_resp.status_code !== 0) {
    throw new Error(body.base_resp.status_msg || `API ${body.base_resp.status_code}`);
  }
  const models = body.model_remains ?? [];
  const windows = [aggregate(models, 'interval'), aggregate(models, 'weekly')].filter(
    (value): value is QuotaWindow => Boolean(value),
  );
  if (windows.length === 0) {
    throw new ProviderError('SCHEMA_CHANGED', 'No MiniMax model quota');
  }
  const presentedWindow = pickPresentedWindow(windows, '1week');
  return {
    kind: 'quota',
    providerId: 'minimax',
    presentedWindow,
    windows,
  };
}

export async function fetchMiniMaxQuota(apiKey: string): Promise<QuotaSnapshot> {
  const key = apiKey.trim();
  if (!key) throw new ProviderError('KEY_MISSING', 'MiniMax Token Plan API Key required');

  const response = await fetch('https://www.minimax.io/v1/token_plan/remains', {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${key}`,
      'User-Agent': 'lean-quota-monitor',
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return parseMiniMaxQuota((await response.json()) as MiniMaxResponse);
}

export const miniMaxProvider = defineSecretProvider({
  id: 'minimax',
  statusBarName: 'M3',
  providerName: 'MiniMax',
  secret: {
    storageKey: 'leanQuotaMonitor.minimax.apiKey',
    pathId: 'minimax-token-plan-api',
    title: 'MiniMax Token Plan API Key',
    setup: 'Set or replace the API Key from this Troubleshoot method.',
    inputPrompt: 'Stored securely in VS Code SecretStorage.',
    inputPlaceholder: 'Paste MiniMax Token Plan API Key',
    actionLabel: 'Set / Replace API Key',
    menuDescription: 'VS Code SecretStorage',
    acquire: fetchMiniMaxQuota,
  },
});
