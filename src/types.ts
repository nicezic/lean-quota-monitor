export type ProviderId =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'minimax'
  | 'kimi'
  | 'zai'
  | 'openrouter'
  | 'vercel'
  | 'opencode'
  | 'deepseek'
  | 'devin'
  | 'copilot';

export const WINDOW_TYPES = {
  '5hour': { short: '5h' },
  '1day': { short: '1d' },
  '1week': { short: '1w' },
  '1month': { short: '1m' },
} as const;

export type WindowType = keyof typeof WINDOW_TYPES;

export interface QuotaWindow {
  type: WindowType;
  usedPercent: number;
  remainingPercent: number;
  resetAt?: Date;
}

const WINDOW_PRIORITY: Record<WindowType, number> = {
  '5hour': 0,
  '1day': 1,
  '1week': 2,
  '1month': 3,
};

// ponytail: sorts the passed array in place (longest window first) — every provider
// calls this before returning its snapshot, so stored snapshots stay normalized.
export function pickPresentedWindow(
  windows: QuotaWindow[],
  primaryWindow: WindowType,
  warningThreshold: number | null = 20,
): WindowType {
  windows.sort((a, b) => WINDOW_PRIORITY[b.type] - WINDOW_PRIORITY[a.type]);
  if (windows.length === 0) return primaryWindow;

  const primary = windows.find((w) => w.type === primaryWindow) ?? windows[0];
  if (warningThreshold === null) return primary.type;

  const urgent = windows
    .filter((w) => w.remainingPercent <= warningThreshold)
    .sort(
      (a, b) =>
        a.remainingPercent - b.remainingPercent ||
        WINDOW_PRIORITY[a.type] - WINDOW_PRIORITY[b.type],
    );

  return urgent[0]?.type ?? primary.type;
}

interface SnapshotBase {
  providerId: ProviderId;
  observedAt?: Date;
}

export interface QuotaSnapshot extends SnapshotBase {
  kind: 'quota';
  presentedWindow: WindowType;
  windows: QuotaWindow[];
}

export interface CreditSnapshot extends SnapshotBase {
  kind: 'credit';
  currency: string;
  totalCredits?: number;
  usedCredits: number;
  remainingCredits: number;
  formattedRemaining: string;
}

export type ProviderSnapshot = QuotaSnapshot | CreditSnapshot;
