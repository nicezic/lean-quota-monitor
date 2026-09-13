import { defineSecretProvider } from '../provider-definition.ts';
import { ProviderError } from '../provider-error.ts';
import type { CreditSnapshot } from '../types.ts';

interface OpenRouterCreditsResponse {
  data?: {
    total_credits?: number;
    total_usage?: number;
  };
}

export function parseOpenRouterCredits(body: OpenRouterCreditsResponse): CreditSnapshot {
  const totalCredits = body.data?.total_credits;
  const usedCredits = body.data?.total_usage;
  if (
    typeof totalCredits !== 'number' ||
    !Number.isFinite(totalCredits) ||
    typeof usedCredits !== 'number' ||
    !Number.isFinite(usedCredits)
  ) {
    throw new ProviderError('SCHEMA_CHANGED', 'Invalid OpenRouter credits response');
  }

  const remainingCredits = totalCredits - usedCredits;
  return {
    kind: 'credit',
    providerId: 'openrouter',
    currency: 'USD',
    totalCredits,
    usedCredits,
    remainingCredits,
    formattedRemaining: `$${remainingCredits.toFixed(2)}`,
  };
}

export async function fetchOpenRouterCredits(managementKey: string): Promise<CreditSnapshot> {
  const key = managementKey.trim();
  if (!key) throw new ProviderError('KEY_MISSING', 'OpenRouter Management Key required');

  const response = await fetch('https://openrouter.ai/api/v1/credits', {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${key}`,
      'User-Agent': 'lean-quota-monitor',
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return parseOpenRouterCredits((await response.json()) as OpenRouterCreditsResponse);
}

export const openRouterProvider = defineSecretProvider({
  id: 'openrouter',
  statusBarName: 'OR',
  providerName: 'OpenRouter',
  secret: {
    storageKey: 'leanQuotaMonitor.openrouter.managementKey',
    pathId: 'openrouter-credits-api',
    title: 'OpenRouter Management Key',
    setup: 'Set or replace the Management Key from this Troubleshoot method.',
    inputPrompt:
      'Required by the OpenRouter credits API. Stored securely in VS Code SecretStorage.',
    inputPlaceholder: 'Paste OpenRouter Management Key',
    actionLabel: 'Set / Replace Management Key',
    menuDescription: 'VS Code SecretStorage · required for credits',
    acquire: fetchOpenRouterCredits,
  },
});
