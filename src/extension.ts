import * as vscode from 'vscode';
import {
  builtInProvider,
  createBuiltInRecord,
  isBuiltInProviderId as isProviderId,
  BUILT_IN_PROVIDERS as PROVIDERS,
} from './built-in-provider.ts';
import { type CustomProviderConfig, runCustomScript } from './custom-provider.ts';
import { configuredCustomProviders, refreshIntervalSeconds } from './monitor-config.ts';
import type { CustomProviderState, ProviderState } from './monitor-presentation.ts';
import { createMonitorUI } from './monitor-ui.ts';
import { currentPlatform } from './platform.ts';
import { acquireProviderPlan, type BuiltInProviderContext } from './provider-definition.ts';
import type { MoveDirection } from './provider-order.ts';
import { type ConcurrentRefreshPolicy, RefreshCoordinator } from './refresh-coordinator.ts';
import type { ProviderId } from './types.ts';

let refreshTimer: NodeJS.Timeout | undefined;
let displayTimer: NodeJS.Timeout | undefined;

export function activate(context: vscode.ExtensionContext): void {
  console.info('[lean-quota-monitor] activate');

  const providerContext: BuiltInProviderContext = {
    platform: currentPlatform(),
    readSecret: (key) => context.secrets.get(key),
  };
  const providerPlans = createBuiltInRecord((id) =>
    builtInProvider(id).snapshotPlan(providerContext),
  );

  const states = createBuiltInRecord<ProviderState>(() => ({}));
  const customStates: Record<string, CustomProviderState> = {};
  const refreshCoordinator = new RefreshCoordinator();
  let previousCustomProviders = configuredCustomProviders();

  const ui = createMonitorUI({
    context,
    states,
    customStates,
    providerPlans,
    refreshBuiltIn,
    refreshCustom,
  });

  function refreshBuiltIn(id: ProviderId, concurrentPolicy: ConcurrentRefreshPolicy = 'join') {
    return refreshCoordinator.run(
      `builtin:${id}`,
      async () => {
        try {
          const { value: snapshot, acquiredVia } = await acquireProviderPlan(providerPlans[id]);
          states[id] = {
            snapshot,
            acquiredVia,
            updatedAt: snapshot.observedAt ?? new Date(),
          };
        } catch (error) {
          states[id] = { error, updatedAt: new Date() };
        } finally {
          ui.render();
        }
      },
      concurrentPolicy,
    );
  }

  function refreshCustom(
    name: string,
    config: CustomProviderConfig,
    concurrentPolicy: ConcurrentRefreshPolicy = 'join',
  ) {
    return refreshCoordinator.run(
      `custom:${name}`,
      async () => {
        try {
          const output = await runCustomScript(config.script);
          customStates[name] = { output, updatedAt: new Date() };
        } catch (error) {
          customStates[name] = { error, updatedAt: new Date() };
        } finally {
          ui.render();
        }
      },
      concurrentPolicy,
    );
  }

  async function refreshConfiguredCustoms() {
    const current = configuredCustomProviders();
    const previous = previousCustomProviders;
    previousCustomProviders = current;
    await Promise.all(
      Object.entries(current).map(([name, config]) =>
        refreshCustom(name, config, previous[name]?.script === config.script ? 'join' : 'rerun'),
      ),
    );
  }

  async function refresh() {
    await Promise.all([
      ...PROVIDERS.map(({ id }) => refreshBuiltIn(id)),
      refreshConfiguredCustoms(),
    ]);
    console.info(`[lean-quota-monitor] refresh complete: ${ui.statusText()}`);
  }

  function scheduleNextRefresh() {
    if (refreshTimer) clearTimeout(refreshTimer);
    const baseSeconds = Math.max(30, refreshIntervalSeconds());
    const jitter = Math.floor(Math.random() * 16);
    const delayMs = (baseSeconds + jitter) * 1000;
    refreshTimer = setTimeout(async () => {
      await refresh();
      scheduleNextRefresh();
    }, delayMs);
  }

  ui.render();
  ui.show();
  console.info(`[lean-quota-monitor] statusbar shown: ${ui.statusText()}`);

  context.subscriptions.push(
    vscode.commands.registerCommand('leanQuotaMonitor.openMonitor', ui.openMonitor),
    vscode.commands.registerCommand(
      'leanQuotaMonitor.openTroubleshoot',
      () => void ui.openTroubleshoot(),
    ),
    vscode.commands.registerCommand('leanQuotaMonitor.refresh', refresh),
    vscode.commands.registerCommand('leanQuotaMonitor.refreshProvider', async (key: string) => {
      if (isProviderId(key)) {
        await refreshBuiltIn(key, 'rerun');
      } else {
        const custom = configuredCustomProviders()[key];
        if (custom) await refreshCustom(key, custom, 'rerun');
      }
      ui.render();
      await ui.refreshStatusVisibility();
    }),
    vscode.commands.registerCommand(
      'leanQuotaMonitor.moveProvider',
      async (key: string, direction: MoveDirection) => {
        if (direction !== 'up' && direction !== 'down') return;
        await ui.moveProviderOrder(key, direction);
      },
    ),

    vscode.commands.registerCommand('leanQuotaMonitor.openSettings', () =>
      vscode.commands.executeCommand(
        'workbench.action.openSettings',
        '@ext:nicezic.lean-quota-monitor',
      ),
    ),
    vscode.commands.registerCommand('leanQuotaMonitor.toggleProvider', async (key: string) => {
      await ui.toggleProviderVisibility(key);
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration('leanQuotaMonitor')) return;
      if (event.affectsConfiguration('leanQuotaMonitor.statusBarAlignment')) {
        ui.updateStatusBarAlignment();
      }
      if (event.affectsConfiguration('leanQuotaMonitor.refreshIntervalSeconds')) {
        scheduleNextRefresh();
      }
      if (event.affectsConfiguration('leanQuotaMonitor.customProviders')) {
        void refreshConfiguredCustoms();
      }
      ui.render();
    }),
  );

  scheduleNextRefresh();
  displayTimer = setInterval(ui.render, 30_000);
  void refresh();
}

export function deactivate(): void {
  if (refreshTimer) clearTimeout(refreshTimer);
  if (displayTimer) clearInterval(displayTimer);
}
