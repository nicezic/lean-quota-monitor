import process from 'node:process';
import { defineSecretProvider } from '../provider-definition.ts';
import { ProviderError } from '../provider-error.ts';
import type { CreditSnapshot } from '../types.ts';

interface DeepSeekBalanceResponse {
  is_available?: boolean;
  balance_infos?: Array<{
    currency?: string;
    total_balance?: string;
    granted_balance?: string;
    topped_up_balance?: string;
  }>;
}

export function parseDeepSeekBalance(body: DeepSeekBalanceResponse): CreditSnapshot {
  const info = body.balance_infos?.[0];
  const total = Number(info?.total_balance);
  if (!info?.currency || !Number.isFinite(total)) {
    throw new ProviderError('SCHEMA_CHANGED', 'Invalid DeepSeek balance response');
  }

  const symbol = info.currency === 'CNY' ? '¥' : '$';
  return {
    kind: 'credit',
    providerId: 'deepseek',
    currency: info.currency,
    totalCredits: total,
    usedCredits: 0,
    remainingCredits: total,
    formattedRemaining: `${symbol}${total.toFixed(2)}`,
  };
}

export async function fetchDeepSeekBalance(apiKey: string): Promise<CreditSnapshot> {
  const key = apiKey.trim() || process.env.DEEPSEEK_API_KEY?.trim() || '';
  if (!key) throw new ProviderError('KEY_MISSING', 'DeepSeek API Key required');

  const response = await fetch('https://api.deepseek.com/user/balance', {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${key}`,
      'User-Agent': 'lean-quota-monitor',
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return parseDeepSeekBalance((await response.json()) as DeepSeekBalanceResponse);
}

export const deepSeekProvider = defineSecretProvider({
  id: 'deepseek',
  statusBarName: 'DS',
  providerName: 'DeepSeek',
  secret: {
    storageKey: 'leanQuotaMonitor.deepseek.apiKey',
    pathId: 'deepseek-balance-api',
    title: 'DeepSeek API Key',
    setup: 'Set or replace the API Key from this Troubleshoot method.',
    inputPrompt: 'Required by the DeepSeek balance API. Stored securely in VS Code SecretStorage.',
    inputPlaceholder: 'Paste DeepSeek API Key',
    actionLabel: 'Set / Replace API Key',
    menuDescription: 'VS Code SecretStorage · required for balance',
    acquire: fetchDeepSeekBalance,
  },
});
