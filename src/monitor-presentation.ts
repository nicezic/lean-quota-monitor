import { AcquisitionPathsError } from './acquisition.ts';
import { type CustomProviderConfig, formatCustomStatus } from './custom-provider.ts';
import { isProviderError } from './provider-error.ts';
import type { ProviderSnapshot, QuotaSnapshot, QuotaWindow } from './types';

export interface ProviderState {
  snapshot?: ProviderSnapshot;
  error?: unknown;
  updatedAt?: Date;
  acquiredVia?: string;
}

export interface CustomProviderState {
  output?: string;
  error?: unknown;
  updatedAt?: Date;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function displayError(error: unknown): string {
  if (error instanceof AcquisitionPathsError && error.failures.length === 1) {
    return displayError(error.failures[0].error);
  }
  if (isProviderError(error)) return error.message;
  if (typeof error === 'object' && error !== null && 'code' in error) {
    if ((error as { code?: unknown }).code === 'ENOENT') return 'Not Found';
  }
  const message = errorMessage(error);
  if (/\bnot found\b/i.test(message) || /no such file or directory/i.test(message)) {
    return 'Not Found';
  }
  return message;
}

export function providerErrorSummary(error: unknown): string {
  if (error instanceof AcquisitionPathsError && error.failures.length > 1) {
    const pathIds = error.failures.map(({ pathId }) => pathId).join(', ');
    return `${error.failures.length} setup methods[ ${pathIds} ] failed`;
  }
  return displayError(error);
}

function shortPercent(value: number): string {
  return `${Math.round(value)}%`;
}

function creditAmount(value: number): string {
  return `$${Math.max(0, value).toFixed(2)}`;
}

function windowByLabel(snapshot: QuotaSnapshot, label: string): QuotaWindow | undefined {
  return snapshot.windows.find((window) => window.label === label);
}

function weeklyWindow(snapshot: QuotaSnapshot): QuotaWindow | undefined {
  return windowByLabel(snapshot, 'Week');
}

function resetRemaining(resetAt: Date | undefined, nowMs = Date.now()): string {
  if (!resetAt || Number.isNaN(resetAt.getTime())) return '';
  const remainingMs = resetAt.getTime() - nowMs;
  if (remainingMs <= 0) return '↻now';

  const hours = Math.floor(remainingMs / 3_600_000);
  if (hours >= 24) return `↻${Math.floor(hours / 24)}d`;
  if (hours >= 1) return `↻${hours}h`;
  return `↻${Math.max(1, Math.ceil(remainingMs / 60_000))}m`;
}

export function providerHasCurrentData(state: ProviderState): boolean {
  return Boolean(state.snapshot) && !state.error;
}

export function customHasCurrentData(state: CustomProviderState): boolean {
  return Boolean(state.output) && !state.error;
}

export function providerStatusText(
  label: string,
  state: ProviderState,
  nowMs = Date.now(),
): string {
  if (state.error) return `${label} --`;
  if (!state.snapshot) return `${label} …`;

  if (state.snapshot.kind === 'credit') {
    return `${label} ${creditAmount(state.snapshot.remainingCredits)}`;
  }

  const weekly = weeklyWindow(state.snapshot);
  if (!weekly) return `${label} --`;

  const reset = resetRemaining(weekly.resetAt, nowMs);
  return `${label} ${shortPercent(weekly.remainingPercent)}${reset ? ` ${reset}` : ''}`;
}

export function customStatusText(config: CustomProviderConfig, state: CustomProviderState): string {
  if (state.error) {
    const message = displayError(state.error);
    return formatCustomStatus(config.label, message === 'Not Found' ? message : '--');
  }
  if (!state.output) return formatCustomStatus(config.label, '…');
  return formatCustomStatus(config.label, state.output);
}

export function formatDateTime(value: Date | undefined): string {
  if (!value || Number.isNaN(value.getTime())) return '--';
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${pad(value.getMonth() + 1)}/${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

function resetRemainingDetailed(resetAt: Date | undefined, nowMs = Date.now()): string {
  if (!resetAt || Number.isNaN(resetAt.getTime())) return '--';
  const remainingMinutes = Math.max(0, Math.ceil((resetAt.getTime() - nowMs) / 60_000));
  const days = Math.floor(remainingMinutes / 1_440);
  const hours = Math.floor((remainingMinutes % 1_440) / 60);
  const minutes = remainingMinutes % 60;
  const clock = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  return days > 0 ? `${days}d ${clock}` : clock;
}

function updatedAgo(updatedAt: Date | undefined, nowMs = Date.now()): string {
  if (!updatedAt || Number.isNaN(updatedAt.getTime())) return 'not yet';
  const seconds = Math.max(0, Math.floor((nowMs - updatedAt.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h ago`;
}

function progressBar(remainingPercent: number): string {
  const width = 20;
  const clamped = Math.max(0, Math.min(100, remainingPercent));
  const filled = Math.round((clamped / 100) * width);
  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`;
}

function quickProgressBar(remainingPercent: number): string {
  const width = 10;
  const clamped = Math.max(0, Math.min(100, remainingPercent));
  const filled = Math.floor((clamped / 100) * width);
  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`;
}

export function quickProviderDescription(state: ProviderState, nowMs = Date.now()): string {
  if (state.error) return providerErrorSummary(state.error);
  if (!state.snapshot) return 'Loading…';
  if (state.snapshot.kind === 'credit') {
    return `Remaining ${creditAmount(state.snapshot.remainingCredits)}`;
  }
  const weekly = weeklyWindow(state.snapshot);
  if (!weekly) return '--';
  const reset = resetRemaining(weekly.resetAt, nowMs);
  return `${quickProgressBar(weekly.remainingPercent)} ${shortPercent(weekly.remainingPercent)}${reset ? ` · ${reset}` : ''}`;
}

export function quickProviderDetail(state: ProviderState, nowMs = Date.now()): string | undefined {
  if (state.error || !state.snapshot || state.snapshot.kind === 'credit') return undefined;
  return state.snapshot.windows
    .map((window) => {
      const reset = resetRemainingDetailed(window.resetAt, nowMs);
      return `${window.label} ${shortPercent(window.remainingPercent)}${reset !== '--' ? ` · ↻ ${reset}` : ''}`;
    })
    .join(' | ');
}

export function providerDetail(
  displayName: string,
  statusBarLabel: string,
  state: ProviderState,
  nowMs = Date.now(),
): { block: string; updated: string } {
  if (state.error) {
    const message = displayError(state.error);
    return {
      block:
        message === 'Not Found'
          ? `${displayName.padEnd(7)}Not Found`
          : `${displayName.padEnd(7)}--\n${'Error'.padEnd(7)}${message}`,
      updated: '',
    };
  }

  if (!state.snapshot) {
    return { block: `${displayName.padEnd(7)}Loading…`, updated: '' };
  }

  if (state.snapshot.kind === 'credit') {
    return {
      block: [
        `**${displayName}**&nbsp;${statusBarLabel}&nbsp;**${creditAmount(state.snapshot.remainingCredits)}**`,
        `Remaining&nbsp;&nbsp;&nbsp;&nbsp;${creditAmount(state.snapshot.remainingCredits)}`,
      ].join('\n'),
      updated: updatedAgo(state.updatedAt, nowMs),
    };
  }

  const weekly = weeklyWindow(state.snapshot);
  if (!weekly) {
    return { block: `${displayName.padEnd(7)}--`, updated: updatedAgo(state.updatedAt, nowMs) };
  }

  const fiveHour = windowByLabel(state.snapshot, '5h');
  const weeklyPercent = shortPercent(weekly.remainingPercent);
  const weeklyReset = formatDateTime(weekly.resetAt);
  const weeklyCountdown = resetRemainingDetailed(weekly.resetAt, nowMs);
  const labelGap = '&nbsp;'.repeat(4);
  const fiveHourSummary = fiveHour
    ? `&nbsp;&nbsp;(5h: ${shortPercent(fiveHour.remainingPercent)} ↻ ${resetRemainingDetailed(fiveHour.resetAt, nowMs)})`
    : '';

  return {
    block: [
      `**${displayName}**&nbsp;${statusBarLabel}&nbsp;**${weeklyPercent}**${fiveHourSummary}`,
      `Weekly${labelGap}${progressBar(weekly.remainingPercent)}`,
      `Resets at${labelGap}${weeklyReset} · ↻ **${weeklyCountdown}** left`,
    ].join('\n'),
    updated: updatedAgo(state.updatedAt, nowMs),
  };
}

export function customDetail(
  name: string,
  state: CustomProviderState,
  nowMs = Date.now(),
): { block: string; updated: string } {
  const error = state.error ? displayError(state.error) : undefined;
  const value = error === 'Not Found' ? error : state.error ? '--' : (state.output ?? 'Loading…');
  const lines = [`**${name}**&nbsp;&nbsp;&nbsp;&nbsp;**${value}**`];
  if (state.error && error !== 'Not Found') {
    lines.push(`Error&nbsp;&nbsp;&nbsp;&nbsp;${error}`);
  }
  return { block: lines.join('\n'), updated: updatedAgo(state.updatedAt, nowMs) };
}
