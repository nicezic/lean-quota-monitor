import type { BuiltInProviderDefinition } from './provider-definition.ts';
import { anthropicProvider } from './providers/anthropic.ts';
import { geminiProvider } from './providers/gemini.ts';
import { kimiProvider } from './providers/kimi.ts';
import { miniMaxProvider } from './providers/minimax.ts';
import { openAIProvider } from './providers/openai.ts';
import { openCodeProvider } from './providers/opencode.ts';
import { openRouterProvider } from './providers/openrouter.ts';
import { zaiProvider } from './providers/zai.ts';
import type { ProviderId } from './types.ts';

export const BUILT_IN_PROVIDERS: readonly BuiltInProviderDefinition[] = [
  openAIProvider,
  anthropicProvider,
  geminiProvider,
  miniMaxProvider,
  kimiProvider,
  zaiProvider,
  openRouterProvider,
  openCodeProvider,
];

const BY_ID = new Map(BUILT_IN_PROVIDERS.map((provider) => [provider.id, provider]));

export function builtInProvider(id: ProviderId): BuiltInProviderDefinition {
  const provider = BY_ID.get(id);
  if (!provider) throw new Error(`Unknown Built-in Provider: ${id}`);
  return provider;
}

export function isBuiltInProviderId(key: string): key is ProviderId {
  return BY_ID.has(key as ProviderId);
}

export function createBuiltInRecord<T>(create: (id: ProviderId) => T): Record<ProviderId, T> {
  return Object.fromEntries(BUILT_IN_PROVIDERS.map(({ id }) => [id, create(id)])) as Record<
    ProviderId,
    T
  >;
}
