import * as vscode from 'vscode';
import { BUILT_IN_PROVIDERS as PROVIDERS } from './built-in-provider.ts';
import { type CustomProviderMap, normalizeCustomProviders } from './custom-provider.ts';
import { normalizeProviderOrder } from './provider-order.ts';
import type { ProviderId, WindowType } from './types.ts';
import { WINDOW_TYPES } from './types.ts';

const monitorConfig = () => vscode.workspace.getConfiguration('leanQuotaMonitor');

export const updateMonitorSetting = (key: string, value: unknown) =>
  monitorConfig().update(key, value, vscode.ConfigurationTarget.Global);

export function configuredStatusBarName(id: ProviderId, fallback: string): string {
  return monitorConfig().get<string>(`${id}StatusBarName`, fallback).trim() || fallback;
}

export function configuredProviderName(id: ProviderId, fallback: string): string {
  return monitorConfig().get<string>(`${id}ProviderName`, fallback).trim() || fallback;
}

export const providerVisible = (id: ProviderId): boolean =>
  monitorConfig().get<boolean>(`${id}Visible`, true);

export function providerPrimaryWindow(id: ProviderId): WindowType | undefined {
  const value = monitorConfig().get<string>(`${id}PrimaryWindow`, 'auto');
  return value in WINDOW_TYPES ? (value as WindowType) : undefined;
}

export function configuredCustomProviders(): CustomProviderMap {
  const configured = monitorConfig().get<Record<string, unknown>>('customProviders', {});
  return normalizeCustomProviders(configured);
}

export function configuredProviderOrder(customProviders = configuredCustomProviders()): string[] {
  const configured = monitorConfig().get<unknown>('providerOrder', []);
  const available = [...PROVIDERS.map(({ id }) => id), ...Object.keys(customProviders)];
  const order = Array.isArray(configured)
    ? configured.filter((key): key is string => typeof key === 'string')
    : [];
  return normalizeProviderOrder(order, available);
}

export const configuredAlignmentSetting = (): 'right' | 'left' =>
  monitorConfig().get<string>('statusBarAlignment', 'right') === 'left' ? 'left' : 'right';

export const configuredAlignment = (): vscode.StatusBarAlignment =>
  configuredAlignmentSetting() === 'left'
    ? vscode.StatusBarAlignment.Left
    : vscode.StatusBarAlignment.Right;

export const refreshIntervalSeconds = () =>
  monitorConfig().get<number>('refreshIntervalSeconds', 180);

export const updateCustomProviders = (providers: CustomProviderMap) =>
  updateMonitorSetting('customProviders', providers);

export const updateProviderOrder = (order: readonly string[]) =>
  updateMonitorSetting('providerOrder', [...order]);

export const updateRefreshIntervalSeconds = (seconds: number) =>
  updateMonitorSetting('refreshIntervalSeconds', seconds);

export function lowQuotaWarningThreshold(): number | null {
  const value = monitorConfig().get<string>('lowQuotaWarningThreshold', '20%');
  if (value === 'off') return null;
  const match = value.match(/^(\d+)%?$/);
  return match ? Number(match[1]) : 20;
}

export const updateLowQuotaWarningThreshold = (value: string) =>
  updateMonitorSetting('lowQuotaWarningThreshold', value);

export const updateProviderPrimaryWindow = (id: ProviderId, value: string) =>
  updateMonitorSetting(`${id}PrimaryWindow`, value);
