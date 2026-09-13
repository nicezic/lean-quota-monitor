import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { BuiltInProviderDefinition } from '../provider-definition.ts';
import { hasErrorCode, ProviderError } from '../provider-error.ts';
import type { QuotaSnapshot, QuotaWindow } from '../types.ts';

const execFileAsync = promisify(execFile);

interface CopilotUsageResponse {
  copilot_plan?: string;
  quota_reset_date?: string;
  quota_reset_date_utc?: string;
  quota_snapshots?: {
    premium_interactions?: {
      percent_remaining?: number;
      remaining?: number;
      entitlement?: number;
      unlimited?: boolean;
      has_quota?: boolean;
    };
  };
}

// ponytail: parse only premium_interactions into 1month window; skip chat and completions (YAGNI).
export function parseCopilotQuota(body: CopilotUsageResponse): QuotaSnapshot {
  const premium = body.quota_snapshots?.premium_interactions;
  if (!premium) {
    throw new ProviderError('SCHEMA_CHANGED', 'Missing premium_interactions quota');
  }

  if (premium.entitlement === 0 && !premium.has_quota && !premium.unlimited) {
    throw new ProviderError('PLAN_REQUIRED', 'Copilot plan does not include premium models');
  }

  let remainingPercent: number;
  if (premium.unlimited) {
    remainingPercent = 100;
  } else if (
    typeof premium.percent_remaining === 'number' &&
    Number.isFinite(premium.percent_remaining)
  ) {
    remainingPercent = Math.max(0, Math.min(100, premium.percent_remaining));
  } else if (
    typeof premium.remaining === 'number' &&
    typeof premium.entitlement === 'number' &&
    premium.entitlement > 0
  ) {
    remainingPercent = Math.max(0, Math.min(100, (premium.remaining / premium.entitlement) * 100));
  } else {
    throw new ProviderError('SCHEMA_CHANGED', 'Invalid premium_interactions format');
  }

  const rawReset = body.quota_reset_date_utc || body.quota_reset_date;
  const resetAt = rawReset ? new Date(rawReset) : undefined;
  const validReset = resetAt && Number.isFinite(resetAt.getTime()) ? resetAt : undefined;

  const window: QuotaWindow = {
    type: '1month',
    usedPercent: 100 - remainingPercent,
    remainingPercent,
    resetAt: validReset,
  };

  return {
    kind: 'quota',
    providerId: 'copilot',
    presentedWindow: '1month',
    windows: [window],
  };
}

async function fetchCopilotQuota(token: string): Promise<QuotaSnapshot> {
  const response = await fetch('https://api.github.com/copilot_internal/user', {
    headers: {
      Authorization: `token ${token.trim()}`,
      Accept: 'application/json',
      'Editor-Version': 'vscode/1.96.2',
      'Editor-Plugin-Version': 'copilot-chat/0.26.7',
      'User-Agent': 'GitHubCopilotChat/0.26.7',
      'X-Github-Api-Version': '2025-04-01',
    },
  });

  if (response.status === 401 || response.status === 403) {
    throw new ProviderError('AUTH_REQUIRED', 'GitHub token rejected or expired');
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const body = (await response.json()) as CopilotUsageResponse;
  return parseCopilotQuota(body);
}

export const copilotProvider: BuiltInProviderDefinition = {
  id: 'copilot',
  statusBarName: 'Copilot',
  providerName: 'GitHub Copilot',
  secret: {
    storageKey: 'leanQuotaMonitor.copilotToken',
    pathId: 'secret-token',
    title: 'GitHub Token',
    setup: 'Generate a GitHub Personal Access Token or OAuth token with read:user scope.',
    inputPrompt: 'GitHub Token (gho_… / ghp_…)',
    inputPlaceholder: 'gho_…',
    actionLabel: 'Configure GitHub Token',
    menuDescription: 'GitHub token for Copilot quota',
    acquire: (secret) => fetchCopilotQuota(secret),
  },
  snapshotPlan(context) {
    return {
      kind: 'available',
      paths: [
        {
          id: 'gh-cli',
          acquire: async () => {
            let token: string;
            try {
              const { stdout } = await execFileAsync('gh', ['auth', 'token']);
              token = stdout.trim();
            } catch (error) {
              if (hasErrorCode(error, 'ENOENT')) {
                throw new ProviderError('CLI_NOT_FOUND', 'gh command not found in PATH');
              }
              throw new ProviderError('AUTH_REQUIRED', 'gh auth login required');
            }
            return fetchCopilotQuota(token);
          },
          troubleshoot: {
            title: 'GitHub CLI (gh auth token)',
            setup: 'Run gh auth login in your terminal to authenticate.',
            lookup: { kind: 'executable', command: 'gh' },
          },
        },
        {
          id: 'secret-token',
          acquire: async () => {
            const token = await context.readSecret('leanQuotaMonitor.copilotToken');
            if (!token) throw new ProviderError('KEY_MISSING', 'GitHub token not configured');
            return fetchCopilotQuota(token);
          },
          troubleshoot: {
            title: 'GitHub Token',
            setup: 'Configure a GitHub token with read:user scope in VS Code SecretStorage.',
            lookup: { kind: 'secret-storage', key: 'leanQuotaMonitor.copilotToken' },
          },
        },
      ],
    };
  },
};
