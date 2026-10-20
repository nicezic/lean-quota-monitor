import { defineSecretProvider } from '../provider-definition.ts';
import { ProviderError } from '../provider-error.ts';
import type { CreditSnapshot } from '../types.ts';

interface VercelCreditsResponse {
  balance?: string;
  total_used?: string;
}

export function parseVercelCredits(body: VercelCreditsResponse | null): CreditSnapshot {
  const balance = body?.balance;
  const totalUsed = body?.total_used;
  if (
    typeof balance !== 'string' ||
    !balance.trim() ||
    typeof totalUsed !== 'string' ||
    !totalUsed.trim()
  ) {
    throw new ProviderError('SCHEMA_CHANGED', 'Invalid Vercel AI Gateway credits response');
  }

  const remainingCredits = Number(balance);
  const usedCredits = Number(totalUsed);
  if (
    !Number.isFinite(remainingCredits) ||
    remainingCredits < 0 ||
    !Number.isFinite(usedCredits) ||
    usedCredits < 0
  ) {
    throw new ProviderError('SCHEMA_CHANGED', 'Invalid Vercel AI Gateway credits response');
  }

  return {
    kind: 'credit',
    providerId: 'vercel',
    currency: 'USD',
    usedCredits,
    remainingCredits,
    formattedRemaining: `$${remainingCredits.toFixed(2)}`,
  };
}

export async function fetchVercelCredits(apiKey: string): Promise<CreditSnapshot> {
  const key = apiKey.trim();
  if (!key) throw new ProviderError('KEY_MISSING', 'Vercel AI Gateway API Key required');

  const response = await fetch('https://ai-gateway.vercel.sh/v1/credits', {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${key}`,
      'User-Agent': 'lean-quota-monitor',
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 401) {
    throw new ProviderError('KEY_INVALID', 'Vercel AI Gateway API key rejected');
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return parseVercelCredits((await response.json()) as VercelCreditsResponse);
}

export const vercelProvider = defineSecretProvider({
  id: 'vercel',
  statusBarName: 'VER',
  providerName: 'Vercel AI Gateway',
  secret: {
    storageKey: 'leanQuotaMonitor.vercel.aiGatewayApiKey',
    pathId: 'vercel-ai-gateway-credits-api',
    title: 'Vercel AI Gateway API Key',
    setup: 'Set or replace the AI Gateway API Key from this Troubleshoot method.',
    inputPrompt:
      'Required by the Vercel AI Gateway credits API. Stored securely in VS Code SecretStorage.',
    inputPlaceholder: 'Paste Vercel AI Gateway API Key',
    actionLabel: 'Set / Replace API Key',
    menuDescription: 'VS Code SecretStorage · required for credits',
    acquire: fetchVercelCredits,
  },
});
