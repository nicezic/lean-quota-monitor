export type ProviderId =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'minimax'
  | 'kimi'
  | 'zai'
  | 'openrouter'
  | 'opencode';

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

const DURATION_PRIORITY: Record<WindowType, number> = {
  '5hour': 0,
  '1day': 1,
  '1week': 2,
  '1month': 3,
};

export function pickStatusWindow(
  windows: readonly QuotaWindow[],
  primaryType: WindowType,
): WindowType {
  if (windows.length === 0) return primaryType;

  const primary = windows.find((w) => w.type === primaryType) ?? windows[0];
  const urgentWindows = windows.filter((w) => w.remainingPercent <= 20);

  if (urgentWindows.length === 0) {
    return primary.type;
  }

  let best = urgentWindows[0];
  for (let i = 1; i < urgentWindows.length; i++) {
    const current = urgentWindows[i];
    if (current.remainingPercent < best.remainingPercent) {
      best = current;
    } else if (current.remainingPercent === best.remainingPercent) {
      if (DURATION_PRIORITY[current.type] < DURATION_PRIORITY[best.type]) {
        best = current;
      }
    }
  }

  if (primary.remainingPercent <= 20) {
    if (best.remainingPercent < primary.remainingPercent) return best.type;
    if (best.remainingPercent === primary.remainingPercent) {
      return DURATION_PRIORITY[best.type] <= DURATION_PRIORITY[primary.type]
        ? best.type
        : primary.type;
    }
  }

  return best.type;
}

interface SnapshotBase {
  providerId: ProviderId;
  observedAt?: Date;
}

export interface QuotaSnapshot extends SnapshotBase {
  kind: 'quota';
  statusType: WindowType;
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
