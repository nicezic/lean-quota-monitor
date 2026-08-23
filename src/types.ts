export type ProviderId =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'minimax'
  | 'kimi'
  | 'zai'
  | 'openrouter'
  | 'opencode';

export interface QuotaWindow {
  label: string;
  usedPercent: number;
  remainingPercent: number;
  resetAt?: Date;
}

interface SnapshotBase {
  id: ProviderId;
  label: string;
  observedAt?: Date;
}

export interface QuotaSnapshot extends SnapshotBase {
  kind: 'quota';
  windows: QuotaWindow[];
}

export interface CreditSnapshot extends SnapshotBase {
  kind: 'credit';
  currency: 'USD';
  totalCredits: number;
  usedCredits: number;
  remainingCredits: number;
}

export type ProviderSnapshot = QuotaSnapshot | CreditSnapshot;
