import { type AcquisitionResult, acquireFromPaths } from './acquisition.ts';
import type { PlatformId } from './platform.ts';
import type { ProviderId, ProviderSnapshot } from './types.ts';

export type ProviderTroubleshootLookup =
  | { kind: 'file'; path: string }
  | { kind: 'executable'; command: string }
  | { kind: 'secret-storage'; key: string };

export interface ProviderTroubleshoot {
  title: string;
  setup: string;
  lookup?: ProviderTroubleshootLookup;
}

export interface ProviderPath {
  id: string;
  acquire: () => Promise<ProviderSnapshot>;
  troubleshoot: ProviderTroubleshoot;
}

export type ProviderPlan =
  | {
      kind: 'available';
      paths: readonly [ProviderPath, ...ProviderPath[]];
    }
  | {
      kind: 'unsupported';
      error: Error;
      troubleshoot: ProviderTroubleshoot;
    };

export type ProviderTroubleshootMethod =
  | (ProviderTroubleshoot & { kind: 'path'; pathId: string })
  | (ProviderTroubleshoot & { kind: 'unsupported' });

export interface BuiltInProviderContext {
  platform: PlatformId;
  readSecret: (key: string) => PromiseLike<string | undefined>;
}

export interface BuiltInSecretDefinition {
  storageKey: string;
  pathId: string;
  title: string;
  setup: string;
  inputPrompt: string;
  inputPlaceholder: string;
  actionLabel: string;
  menuDescription: string;
  acquire: (secret: string) => Promise<ProviderSnapshot>;
}

export interface BuiltInProviderDefinition {
  id: ProviderId;
  statusBarName: string;
  providerName: string;
  secret?: BuiltInSecretDefinition;
  snapshotPlan(context: BuiltInProviderContext): ProviderPlan;
}

interface SecretProviderDefinition {
  id: ProviderId;
  statusBarName: string;
  providerName: string;
  secret: BuiltInSecretDefinition;
}

export function acquireProviderPlan(
  plan: ProviderPlan,
): Promise<AcquisitionResult<ProviderSnapshot>> {
  if (plan.kind === 'unsupported') return Promise.reject(plan.error);
  return acquireFromPaths(plan.paths);
}

export function providerTroubleshootMethods(
  plan: ProviderPlan,
): readonly ProviderTroubleshootMethod[] {
  if (plan.kind === 'unsupported') {
    return [{ kind: 'unsupported', ...plan.troubleshoot }];
  }
  return plan.paths.map(({ id, troubleshoot }) => ({
    kind: 'path',
    pathId: id,
    ...troubleshoot,
  }));
}

export function defineSecretProvider(
  definition: SecretProviderDefinition,
): BuiltInProviderDefinition {
  const { secret } = definition;
  return {
    ...definition,
    snapshotPlan({ readSecret }) {
      return {
        kind: 'available',
        paths: [
          {
            id: secret.pathId,
            acquire: async () => secret.acquire((await readSecret(secret.storageKey)) ?? ''),
            troubleshoot: {
              title: secret.title,
              setup: secret.setup,
              lookup: { kind: 'secret-storage', key: secret.storageKey },
            },
          },
        ],
      };
    },
  };
}
