import * as fs from 'node:fs';
import * as path from 'node:path';
import process from 'node:process';
import * as vscode from 'vscode';
import { AcquisitionPathsError } from './acquisition';
import {
  builtInProvider,
  createBuiltInRecord,
  isBuiltInProviderId as isProviderId,
  BUILT_IN_PROVIDERS as PROVIDERS,
} from './built-in-provider';
import {
  type CustomProviderConfig,
  type CustomProviderMap,
  normalizeCustomProviders,
  runCustomScript,
} from './custom-provider';
import {
  type CustomProviderState,
  customDetail,
  customHasCurrentData,
  customStatusText,
  displayError,
  errorMessage,
  formatDateTime,
  type ProviderState,
  providerDetail,
  providerErrorSummary,
  providerHasCurrentData,
  providerStatusText,
  quickProviderDescription,
  quickProviderDetail,
} from './monitor-presentation';
import { currentPlatform } from './platform.ts';
import {
  acquireProviderPlan,
  type BuiltInProviderContext,
  type ProviderTroubleshootMethod,
  providerTroubleshootMethods,
} from './provider-definition.ts';
import { isProviderError } from './provider-error.ts';
import {
  type MoveDirection,
  moveProviderAmong,
  normalizeProviderOrder,
  removeProviderFromOrder,
  renameProviderInOrder,
} from './provider-order';
import { type ConcurrentRefreshPolicy, RefreshCoordinator } from './refresh-coordinator';
import type { ProviderId } from './types';

let refreshTimer: NodeJS.Timeout | undefined;
let displayTimer: NodeJS.Timeout | undefined;

type MonitorItem = vscode.QuickPickItem & {
  action?: 'builtin' | 'custom' | 'refresh-all' | 'configure' | 'close';
  providerId?: ProviderId;
  customName?: string;
};

type ConfigureItem = vscode.QuickPickItem & {
  action?: 'back' | 'builtin' | 'custom' | 'add-custom' | 'troubleshoot' | 'open-settings';
  providerKey?: string;
};

type TroubleshootItem = vscode.QuickPickItem & {
  action?: 'back' | 'provider' | 'custom-edit';
  providerId?: ProviderId;
  customName?: string;
};

type ProviderTroubleshootItem = vscode.QuickPickItem & {
  action: 'back' | 'method' | 'debug';
  methodIndex?: number;
};

function configuredLabel(id: ProviderId, fallback: string): string {
  return (
    vscode.workspace
      .getConfiguration('leanQuotaMonitor')
      .get<string>(`${id}Label`, fallback)
      .trim() || fallback
  );
}

function configuredDisplayName(id: ProviderId, fallback: string): string {
  return (
    vscode.workspace
      .getConfiguration('leanQuotaMonitor')
      .get<string>(`${id}Name`, fallback)
      .trim() || fallback
  );
}

function providerVisible(id: ProviderId): boolean {
  return vscode.workspace.getConfiguration('leanQuotaMonitor').get<boolean>(`${id}Visible`, true);
}

function configuredCustomProviders(): CustomProviderMap {
  const configured = vscode.workspace
    .getConfiguration('leanQuotaMonitor')
    .get<Record<string, unknown>>('customProviders', {});
  return normalizeCustomProviders(configured);
}

function configuredProviderOrder(customProviders = configuredCustomProviders()): string[] {
  const configured = vscode.workspace
    .getConfiguration('leanQuotaMonitor')
    .get<unknown>('providerOrder', []);
  const available = [...PROVIDERS.map(({ id }) => id), ...Object.keys(customProviders)];
  const order = Array.isArray(configured)
    ? configured.filter((key): key is string => typeof key === 'string')
    : [];
  return normalizeProviderOrder(order, available);
}

function redactedErrorLines(error: unknown): string[] {
  if (error instanceof AcquisitionPathsError) {
    return error.failures.flatMap(({ pathId, error: pathError }) => [
      `Path: ${pathId}`,
      ...redactedErrorLines(pathError).map((line) => `  ${line}`),
    ]);
  }
  if (isProviderError(error)) {
    return [
      `Error Code: ${error.code}`,
      `Error: ${error.message}`,
      ...(error.detail ? [`Detail: ${error.detail}`] : []),
    ];
  }
  const message = errorMessage(error);
  if (/^HTTP \d{3}$/.test(message)) return [`Error: ${message}`];
  if (/timeout/i.test(message)) return ['Error: Request timed out'];
  if (displayError(error) === 'Not Found') return ['Error: Not Found'];
  return ['Error: Unclassified acquisition failure'];
}

function failureForMethod(
  error: unknown,
  method: ProviderTroubleshootMethod,
  methodCount: number,
): unknown | undefined {
  if (method.kind === 'unsupported') return error;
  if (error instanceof AcquisitionPathsError) {
    return error.failures.find((failure) => failure.pathId === method.pathId)?.error;
  }
  return methodCount === 1 ? error : undefined;
}

function troubleshootAdvice(error: unknown): string {
  if (isProviderError(error)) {
    switch (error.code) {
      case 'CLI_NOT_FOUND':
        return 'Install the CLI or make sure its command is available on PATH.';
      case 'AUTH_REQUIRED':
        return 'Login information was not found. Run the login step for this method.';
      case 'KEY_MISSING':
        return "The API key is not configured. Add it from this provider's Configure menu.";
      case 'KEY_INVALID':
        return 'The configured API key was rejected. Replace it with a valid key.';
      case 'PLAN_REQUIRED':
        return 'This account does not appear to have the required plan.';
      case 'QUOTA_EXHAUSTED':
        return 'The quota is currently exhausted. Check the provider reset time or plan.';
      case 'SCHEMA_CHANGED':
        return 'The quota response format is no longer supported. The integration may need an update.';
    }
  }
  if (displayError(error) === 'Not Found') {
    return 'A required command or credential file was not found. Check installation, login, and PATH.';
  }
  if (/timeout/i.test(errorMessage(error)))
    return 'The provider did not respond before the timeout.';
  return 'Review the setup for this method and retry Refresh.';
}

function troubleshootLookupLines(method: ProviderTroubleshootMethod): string[] {
  const lookup = method.lookup;
  if (!lookup) return [];

  if (lookup.kind === 'file') {
    return ['File PATH:', `  ${lookup.path}`];
  }

  if (lookup.kind === 'secret-storage') {
    return ['Storage: VS Code SecretStorage', `Storage Key: ${lookup.key}`];
  }

  const pathEntries = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  const hasExtension = path.extname(lookup.command).length > 0;
  const pathExtensions =
    process.platform === 'win32' && !hasExtension
      ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
      : [''];
  const candidates = pathEntries.flatMap((entry) =>
    pathExtensions.map((extension) => path.join(entry, `${lookup.command}${extension}`)),
  );
  const resolved = candidates.find((candidate) => fs.existsSync(candidate));

  if (resolved) {
    return ['Executable PATH:', `  ${resolved}`];
  }

  return [`Executable: ${lookup.command}`, 'Result: Not found in PATH'];
}

function commandLink(command: string, label: string, args?: unknown[]): string {
  const query = args ? `?${encodeURIComponent(JSON.stringify(args))}` : '';
  return `[${label}](command:${command}${query})`;
}

function tooltip(
  states: Record<ProviderId, ProviderState>,
  customStates: Record<string, CustomProviderState>,
  orderOverride?: readonly string[],
): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, true);
  md.isTrusted = {
    enabledCommands: [
      'leanQuotaMonitor.toggleProvider',
      'leanQuotaMonitor.refresh',
      'leanQuotaMonitor.openMonitor',
      'leanQuotaMonitor.openTroubleshoot',
      'leanQuotaMonitor.openSettings',
      'leanQuotaMonitor.moveProvider',
    ],
  };

  const customProviders = configuredCustomProviders();
  const available = [...PROVIDERS.map(({ id }) => id), ...Object.keys(customProviders)];
  const order = orderOverride
    ? normalizeProviderOrder(orderOverride, available)
    : configuredProviderOrder(customProviders);
  const healthyOrder = order.filter((key) =>
    isProviderId(key)
      ? providerHasCurrentData(states[key])
      : customHasCurrentData(customStates[key] ?? {}),
  );

  const quickConfigLink = commandLink('leanQuotaMonitor.openMonitor', '🎚️Quick Configure');
  const settingsLink = commandLink('leanQuotaMonitor.openSettings', '⚙️');
  const troubleshootLink = commandLink('leanQuotaMonitor.openTroubleshoot', '📋');
  const refreshLink = commandLink('leanQuotaMonitor.refresh', '🔄');
  md.appendMarkdown(
    `${quickConfigLink} | ${settingsLink} | ${troubleshootLink} | ${refreshLink}  \n\n---\n\n`,
  );

  const sections: { key: string; block: string; updated: string }[] = [];
  for (const key of healthyOrder) {
    if (isProviderId(key)) {
      const provider = builtInProvider(key);
      const detail = providerDetail(
        configuredDisplayName(key, provider.displayNameFallback),
        configuredLabel(key, provider.statusBarFallback),
        states[key],
      );
      sections.push({ key, ...detail });
      continue;
    }
    const config = customProviders[key];
    if (!config) continue;
    const detail = customDetail(key, customStates[key] ?? {});
    sections.push({ key, ...detail });
  }

  sections.forEach((detail, index) => {
    md.appendMarkdown(`${detail.block.replaceAll('\n', '  \n')}  \n`);
    if (detail.updated) {
      const controls: string[] = [
        commandLink('leanQuotaMonitor.toggleProvider', '👀', [detail.key]),
      ];
      if (index > 0) {
        controls.push(commandLink('leanQuotaMonitor.moveProvider', '⏶', [detail.key, 'up']));
      }
      if (index < sections.length - 1) {
        controls.push(commandLink('leanQuotaMonitor.moveProvider', '⏷', [detail.key, 'down']));
      }
      md.appendMarkdown(`*Updated ${detail.updated}* | ${controls.join(' | ')}`);
    }
    if (index < sections.length - 1) md.appendMarkdown('\n\n---\n\n');
  });

  return md;
}

export function activate(context: vscode.ExtensionContext): void {
  console.info('[lean-quota-monitor] activate');

  const providerContext: BuiltInProviderContext = {
    platform: currentPlatform(),
    readSecret: (key) => context.secrets.get(key),
  };
  const providerPlans = createBuiltInRecord((id) =>
    builtInProvider(id).snapshotPlan(providerContext),
  );
  const troubleshootMethods = (id: ProviderId): readonly ProviderTroubleshootMethod[] =>
    providerTroubleshootMethods(providerPlans[id]);

  const states = createBuiltInRecord<ProviderState>(() => ({}));
  const customStates: Record<string, CustomProviderState> = {};
  const refreshCoordinator = new RefreshCoordinator();
  let previousCustomProviders = configuredCustomProviders();
  let activeQuickPick: vscode.QuickPick<MonitorItem> | undefined;

  const item = vscode.window.createStatusBarItem(
    'leanQuotaMonitor.summary',
    vscode.StatusBarAlignment.Right,
    10_000,
  );
  item.name = 'Lean Quota Monitor';
  context.subscriptions.push(item);

  const render = (
    orderOverride?: readonly string[],
    visibilityOverride?: ReadonlyMap<string, boolean>,
  ) => {
    const customProviders = configuredCustomProviders();
    const available = [...PROVIDERS.map(({ id }) => id), ...Object.keys(customProviders)];
    const order = orderOverride
      ? normalizeProviderOrder(orderOverride, available)
      : configuredProviderOrder(customProviders);
    const visibleText: string[] = [];

    for (const key of order) {
      if (isProviderId(key)) {
        const visible = visibilityOverride?.get(key) ?? providerVisible(key);
        if (!visible || !providerHasCurrentData(states[key])) continue;
        const provider = builtInProvider(key);
        visibleText.push(
          providerStatusText(configuredLabel(key, provider.statusBarFallback), states[key]),
        );
        continue;
      }
      const config = customProviders[key];
      const state = customStates[key] ?? {};
      const visible = visibilityOverride?.get(key) ?? config?.visible ?? true;
      if (!config || !visible || !customHasCurrentData(state)) continue;
      visibleText.push(customStatusText(config, state));
    }

    item.text = visibleText.length > 0 ? visibleText.join(' │ ') : 'Quota';
    item.tooltip = tooltip(states, customStates, order);
    if (activeQuickPick) {
      activeQuickPick.items = buildMonitorItems(order, visibilityOverride);
    }
  };

  render();
  item.show();
  console.info(`[lean-quota-monitor] statusbar shown: ${item.text}`);

  const refreshBuiltIn = (id: ProviderId, concurrentPolicy: ConcurrentRefreshPolicy = 'join') =>
    refreshCoordinator.run(
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
          render();
        }
      },
      concurrentPolicy,
    );

  const refreshCustom = (
    name: string,
    config: CustomProviderConfig,
    concurrentPolicy: ConcurrentRefreshPolicy = 'join',
  ) =>
    refreshCoordinator.run(
      `custom:${name}`,
      async () => {
        try {
          const output = await runCustomScript(config.script);
          customStates[name] = { output, updatedAt: new Date() };
        } catch (error) {
          customStates[name] = { error, updatedAt: new Date() };
        } finally {
          render();
        }
      },
      concurrentPolicy,
    );

  const refreshConfiguredCustoms = async () => {
    const current = configuredCustomProviders();
    const previous = previousCustomProviders;
    previousCustomProviders = current;
    await Promise.all(
      Object.entries(current).map(([name, config]) =>
        refreshCustom(name, config, previous[name]?.script === config.script ? 'join' : 'rerun'),
      ),
    );
  };

  const refresh = async () => {
    await Promise.all([
      ...PROVIDERS.map(({ id }) => refreshBuiltIn(id)),
      refreshConfiguredCustoms(),
    ]);
    console.info(`[lean-quota-monitor] refresh complete: ${item.text}`);
  };

  const buildMonitorItems = (
    orderOverride?: readonly string[],
    visibilityOverride?: ReadonlyMap<string, boolean>,
  ): MonitorItem[] => {
    const items: MonitorItem[] = [];
    const customProviders = configuredCustomProviders();
    const available = [...PROVIDERS.map(({ id }) => id), ...Object.keys(customProviders)];
    const order = orderOverride
      ? normalizeProviderOrder(orderOverride, available)
      : configuredProviderOrder(customProviders);

    for (const key of order) {
      if (isProviderId(key)) {
        const state = states[key];
        if (!providerHasCurrentData(state)) continue;
        const provider = builtInProvider(key);
        items.push({
          label: configuredDisplayName(key, provider.displayNameFallback),
          description: `${quickProviderDescription(state)}${(visibilityOverride?.get(key) ?? providerVisible(key)) ? '' : ' · Off'}`,
          detail: quickProviderDetail(state),
          action: 'builtin',
          providerId: key,
          buttons: [{ iconPath: new vscode.ThemeIcon('refresh'), tooltip: 'Refresh now' }],
        });
        continue;
      }

      const config = customProviders[key];
      const state = customStates[key] ?? {};
      if (!config) continue;
      items.push({
        label: key,
        description: `${state.output ?? (state.error ? displayError(state.error) : 'Loading…')}${(visibilityOverride?.get(key) ?? config.visible) ? '' : ' · Off'}`,
        detail: `Status Bar: ${config.label} · ${config.script}`,
        action: 'custom',
        customName: key,
        buttons: [{ iconPath: new vscode.ThemeIcon('refresh'), tooltip: 'Refresh now' }],
      });
    }

    items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
    items.push({ label: '$(refresh) Refresh All', action: 'refresh-all', alwaysShow: true });
    items.push({ label: '$(gear) Configure', action: 'configure', alwaysShow: true });
    items.push({ label: '$(close) Close', action: 'close', alwaysShow: true });
    return items;
  };

  const updateCustomProviders = async (providers: CustomProviderMap) => {
    await vscode.workspace
      .getConfiguration('leanQuotaMonitor')
      .update('customProviders', providers, vscode.ConfigurationTarget.Global);
  };

  const updateProviderOrder = async (order: readonly string[]) => {
    await vscode.workspace
      .getConfiguration('leanQuotaMonitor')
      .update('providerOrder', [...order], vscode.ConfigurationTarget.Global);
  };

  const moveProviderOrder = async (key: string, direction: MoveDirection) => {
    const customProviders = configuredCustomProviders();
    const order = configuredProviderOrder(customProviders);
    const movable = order.filter((entry) =>
      isProviderId(entry)
        ? providerHasCurrentData(states[entry])
        : customHasCurrentData(customStates[entry] ?? {}),
    );
    const nextOrder = moveProviderAmong(order, key, direction, movable);
    render(nextOrder);
    await updateProviderOrder(nextOrder);
    render(nextOrder);
    item.hide();
    await new Promise((resolve) => setTimeout(resolve, 0));
    item.show();
  };

  const toggleProviderVisibility = async (key: string) => {
    if (isProviderId(key)) {
      const builtIn = builtInProvider(key);
      const config = vscode.workspace.getConfiguration('leanQuotaMonitor');
      const setting = `${builtIn.id}Visible`;
      const nextVisible = !config.get<boolean>(setting, true);
      const override = new Map<string, boolean>([[key, nextVisible]]);
      render(undefined, override);
      await config.update(setting, nextVisible, vscode.ConfigurationTarget.Global);
      render(undefined, override);
      return;
    }

    const current = configuredCustomProviders();
    const custom = current[key];
    if (!custom) return;
    const nextVisible = !custom.visible;
    const override = new Map<string, boolean>([[key, nextVisible]]);
    render(undefined, override);
    await updateCustomProviders({
      ...current,
      [key]: { ...custom, visible: nextVisible },
    });
    render(undefined, override);
  };

  const showInputWithBack = (options: {
    title: string;
    prompt?: string;
    placeholder?: string;
    value?: string;
    validate?: (value: string) => string | undefined;
  }): Promise<{ action: 'accept'; value: string } | { action: 'back' } | { action: 'cancel' }> =>
    new Promise((resolve) => {
      const input = vscode.window.createInputBox();
      input.title = options.title;
      input.prompt = options.prompt;
      input.placeholder = options.placeholder;
      input.value = options.value ?? '';
      input.ignoreFocusOut = true;
      input.buttons = [vscode.QuickInputButtons.Back];

      let settled = false;
      const finish = (
        result: { action: 'accept'; value: string } | { action: 'back' } | { action: 'cancel' },
      ) => {
        if (settled) return;
        settled = true;
        input.hide();
        input.dispose();
        resolve(result);
      };

      input.onDidChangeValue(() => {
        input.validationMessage = undefined;
      });
      input.onDidAccept(() => {
        const value = input.value.trim();
        const validationMessage = options.validate?.(value);
        if (validationMessage) {
          input.validationMessage = validationMessage;
          return;
        }
        finish({ action: 'accept', value });
      });
      input.onDidTriggerButton((button) => {
        if (button === vscode.QuickInputButtons.Back) finish({ action: 'back' });
      });
      input.onDidHide(() => finish({ action: 'cancel' }));
      input.show();
    });

  const addCustomProvider = async () => {
    const current = configuredCustomProviders();
    let step: 'name' | 'label' | 'script' = 'name';
    let name = '';
    let label = '';
    let script = '';

    for (;;) {
      if (step === 'name') {
        const result = await showInputWithBack({
          title: 'Add Custom Provider · Provider Name',
          prompt: 'Name shown in Hover and Quick Pick.',
          placeholder: 'MyProviderName',
          value: name,
          validate: (value) => {
            if (!value) return 'Provider Name is required.';
            if (isProviderId(value) || Object.hasOwn(current, value)) {
              return `Provider Name "${value}" already exists.`;
            }
            return undefined;
          },
        });
        if (result.action === 'cancel' || result.action === 'back') return;
        name = result.value;
        step = 'label';
        continue;
      }

      if (step === 'label') {
        const result = await showInputWithBack({
          title: 'Add Custom Provider · Status Bar Name',
          prompt: 'Short name shown before Status Output in the Status Bar.',
          placeholder: 'MY',
          value: label,
          validate: (value) => (value ? undefined : 'Status Bar Name is required.'),
        });
        if (result.action === 'cancel') return;
        if (result.action === 'back') {
          step = 'name';
          continue;
        }
        label = result.value;
        step = 'script';
        continue;
      }

      const result = await showInputWithBack({
        title: 'Add Custom Provider · Script Path',
        prompt: 'Executable path only. stdout becomes the single-line Status Output.',
        placeholder: '~/.local/bin/my-provider-credit',
        value: script,
        validate: (value) => (value ? undefined : 'Script Path is required.'),
      });
      if (result.action === 'cancel') return;
      if (result.action === 'back') {
        step = 'label';
        continue;
      }
      script = result.value;
      break;
    }

    const custom = { label, script, visible: true };
    const nextProviders = { ...current, [name]: custom };
    const nextOrder = configuredProviderOrder(nextProviders);
    customStates[name] = {};
    await updateCustomProviders(nextProviders);
    await updateProviderOrder(nextOrder);
    render(nextOrder);
  };

  const openCustomProvider = async (name: string) => {
    const current = configuredCustomProviders();
    const custom = current[name];
    if (!custom) return;

    const choice = await vscode.window.showQuickPick(
      [
        { label: '$(arrow-left) Back', action: 'back' as const },
        {
          label: custom.visible
            ? '$(eye-closed) Hide from Status Bar'
            : '$(eye) Show in Status Bar',
          action: 'toggle' as const,
        },
        { label: '$(edit) Change Provider Name', action: 'rename' as const },
        { label: '$(symbol-key) Change Status Bar Name', action: 'label' as const },
        { label: '$(file-code) Change Script Path', action: 'path' as const },
        { label: '$(trash) Delete Custom Provider', action: 'delete' as const },
      ],
      {
        title: `Lean Quota Monitor · ${name}`,
        placeHolder: customStates[name]?.error
          ? `Error: ${displayError(customStates[name].error)}`
          : 'Custom Provider actions',
        ignoreFocusOut: true,
      },
    );
    if (!choice || choice.action === 'back') return;

    if (choice.action === 'toggle') {
      await toggleProviderVisibility(name);
      return;
    }

    if (choice.action === 'rename') {
      const nextName = (
        await vscode.window.showInputBox({
          title: `Provider Name · ${name}`,
          value: name,
          ignoreFocusOut: true,
        })
      )?.trim();
      if (!nextName || nextName === name) return;
      if (isProviderId(nextName) || Object.hasOwn(current, nextName)) {
        vscode.window.showErrorMessage(`Provider Name "${nextName}" already exists.`);
        return;
      }

      const renamed: CustomProviderMap = {};
      for (const [entryName, entryConfig] of Object.entries(current)) {
        renamed[entryName === name ? nextName : entryName] = entryConfig;
      }
      const nextOrder = renameProviderInOrder(configuredProviderOrder(current), name, nextName);
      customStates[nextName] = customStates[name] ?? {};
      delete customStates[name];
      await updateCustomProviders(renamed);
      await updateProviderOrder(nextOrder);
      render(nextOrder);
      return;
    }

    if (choice.action === 'label') {
      const nextLabel = (
        await vscode.window.showInputBox({
          title: `Status Bar Name · ${name}`,
          value: custom.label,
          placeHolder: 'MY',
          ignoreFocusOut: true,
        })
      )?.trim();
      if (!nextLabel || nextLabel === custom.label) return;
      await updateCustomProviders({ ...current, [name]: { ...custom, label: nextLabel } });
      render();
      return;
    }

    if (choice.action === 'path') {
      const nextPath = (
        await vscode.window.showInputBox({
          title: `Script Path · ${name}`,
          value: custom.script,
          prompt: 'Executable path only; no shell command or arguments.',
          placeHolder: '~/.local/bin/my-provider-credit',
          ignoreFocusOut: true,
        })
      )?.trim();
      if (!nextPath || nextPath === custom.script) return;
      const nextCustom = { ...custom, script: nextPath };
      customStates[name] = {};
      await updateCustomProviders({ ...current, [name]: nextCustom });
      render();
      return;
    }

    const confirmed = await vscode.window.showWarningMessage(
      `Delete Custom Provider "${name}"?`,
      { modal: true },
      'Delete',
    );
    if (confirmed !== 'Delete') return;
    const next = { ...current };
    delete next[name];
    delete customStates[name];
    const nextOrder = removeProviderFromOrder(configuredProviderOrder(current), name);
    await updateCustomProviders(next);
    await updateProviderOrder(nextOrder);
    render(nextOrder);
  };

  const openBuiltInSettings = async (id: ProviderId) => {
    await vscode.commands.executeCommand(
      'workbench.action.openSettings',
      `@ext:nicezic.lean-quota-monitor leanQuotaMonitor.${id}`,
    );
  };

  const setBuiltInSecret = async (id: ProviderId): Promise<boolean> => {
    const secret = builtInProvider(id).secret;
    if (!secret) return false;

    const value = await vscode.window.showInputBox({
      title: secret.title,
      prompt: secret.inputPrompt,
      placeHolder: secret.inputPlaceholder,
      password: true,
      ignoreFocusOut: true,
    });
    const key = value?.trim();
    if (!key) return false;
    await context.secrets.store(secret.storageKey, key);
    await refreshBuiltIn(id, 'rerun');
    return true;
  };

  const updateBuiltInTextSetting = async (
    id: ProviderId,
    field: 'Name' | 'Label',
    currentValue: string,
    title: string,
  ): Promise<void> => {
    const value = await vscode.window.showInputBox({
      title,
      value: currentValue,
      ignoreFocusOut: true,
    });
    const next = value?.trim();
    if (!next || next === currentValue) return;
    await vscode.workspace
      .getConfiguration('leanQuotaMonitor')
      .update(`${id}${field}`, next, vscode.ConfigurationTarget.Global);
    render();
  };

  const showRedactedDebugInfo = async (id: ProviderId): Promise<void> => {
    const state = states[id];
    if (!state.error) return;
    const provider = builtInProvider(id);
    const displayName = configuredDisplayName(id, provider.displayNameFallback);
    const detail = [
      `Provider: ${displayName}`,
      'Status: Error',
      `Updated: ${formatDateTime(state.updatedAt)}`,
      ...redactedErrorLines(state.error),
    ].join('\n');
    await vscode.window.showInformationMessage('Lean Quota Monitor · Redacted Debug Info', {
      modal: true,
      detail,
    });
  };

  const openBuiltInProvider = async (id: ProviderId): Promise<void> => {
    const provider = builtInProvider(id);

    type BuiltInAction =
      | 'back'
      | 'toggle'
      | 'name'
      | 'label'
      | 'secret'
      | 'settings'
      | 'troubleshoot';

    for (;;) {
      const visible = providerVisible(id);
      const items: (vscode.QuickPickItem & { action: BuiltInAction })[] = [
        { label: '$(arrow-left) Back', action: 'back', alwaysShow: true },
        {
          label: visible ? '$(eye-closed) Hide from Status Bar' : '$(eye) Show in Status Bar',
          action: 'toggle',
        },
        {
          label: '$(edit) Change Provider Name',
          description: configuredDisplayName(id, provider.displayNameFallback),
          action: 'name',
        },
        {
          label: '$(symbol-key) Change Status Bar Name',
          description: configuredLabel(id, provider.statusBarFallback),
          action: 'label',
        },
      ];

      const secret = provider.secret;
      if (secret) {
        items.push({
          label: `$(key) ${secret.actionLabel}`,
          description: secret.menuDescription,
          action: 'secret',
        });
      }
      if (states[id].error) {
        items.push({
          label: '$(tools) Troubleshoot',
          description: providerErrorSummary(states[id].error),
          action: 'troubleshoot',
        });
      }
      items.push({ label: '$(settings-gear) Open Provider Settings', action: 'settings' });

      const selected = await vscode.window.showQuickPick(items, {
        title: `Lean Quota Monitor · ${configuredDisplayName(id, provider.displayNameFallback)}`,
        placeHolder: states[id].error
          ? `Error: ${providerErrorSummary(states[id].error)}`
          : 'Provider actions',
        ignoreFocusOut: true,
      });
      if (!selected || selected.action === 'back') return;

      if (selected.action === 'toggle') {
        await toggleProviderVisibility(id);
        continue;
      }
      if (selected.action === 'name') {
        await updateBuiltInTextSetting(
          id,
          'Name',
          configuredDisplayName(id, provider.displayNameFallback),
          `Provider Name · ${configuredDisplayName(id, provider.displayNameFallback)}`,
        );
        continue;
      }
      if (selected.action === 'label') {
        await updateBuiltInTextSetting(
          id,
          'Label',
          configuredLabel(id, provider.statusBarFallback),
          `Status Bar Name · ${configuredDisplayName(id, provider.displayNameFallback)}`,
        );
        continue;
      }
      if (selected.action === 'secret') {
        await setBuiltInSecret(id);
        continue;
      }
      if (selected.action === 'settings') {
        await openBuiltInSettings(id);
        return;
      }
      await openBuiltInTroubleshoot(id);
    }
  };

  const buildConfigureItems = (): ConfigureItem[] => {
    const items: ConfigureItem[] = [
      { label: '$(arrow-left) Back', action: 'back', alwaysShow: true },
      { label: 'Built-in', kind: vscode.QuickPickItemKind.Separator },
    ];

    for (const { id, displayNameFallback, statusBarFallback } of PROVIDERS) {
      if (!providerHasCurrentData(states[id])) continue;
      const visible = providerVisible(id);
      items.push({
        label: `${visible ? '$(check)' : '$(circle-slash)'} ${configuredDisplayName(id, displayNameFallback)}`,
        description: `Status Bar: ${configuredLabel(id, statusBarFallback)} · ${visible ? 'On' : 'Off'}`,
        action: 'builtin',
        providerKey: id,
      });
    }

    const customProviders = Object.entries(configuredCustomProviders());
    items.push({ label: 'Custom', kind: vscode.QuickPickItemKind.Separator });
    for (const [name, config] of customProviders) {
      const state = customStates[name] ?? {};
      items.push({
        label: `${config.visible ? '$(check)' : '$(circle-slash)'} ${name}`,
        description: state.error
          ? `Error: ${displayError(state.error)}`
          : `Status Bar: ${config.label} · ${config.visible ? 'On' : 'Off'}`,
        action: 'custom',
        providerKey: name,
      });
    }
    items.push({ label: '$(add) Add Custom Provider', action: 'add-custom', alwaysShow: true });

    items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
    items.push({
      label: '$(tools) Troubleshoot',
      action: 'troubleshoot',
      alwaysShow: true,
    });
    items.push({
      label: '$(settings-gear) Open VS Code Settings',
      action: 'open-settings',
      alwaysShow: true,
    });
    return items;
  };

  async function openBuiltInTroubleshoot(id: ProviderId): Promise<void> {
    const provider = builtInProvider(id);
    const plan = providerPlans[id];

    for (;;) {
      const state = states[id];
      const methods = troubleshootMethods(id);
      const items: ProviderTroubleshootItem[] = [
        { label: '$(arrow-left) Back', action: 'back', alwaysShow: true },
        ...methods.map((candidate, index) => {
          const failure = state.error
            ? failureForMethod(state.error, candidate, methods.length)
            : undefined;
          return {
            label: `${failure ? '$(error)' : '$(check)'} ${index + 1}. ${candidate.title}`,
            description: failure
              ? isProviderError(failure)
                ? failure.code
                : displayError(failure)
              : 'No current failure',
            detail: candidate.setup,
            action: 'method' as const,
            methodIndex: index,
          };
        }),
        ...(state.error
          ? [
              {
                label: '$(bug) Redacted Debug Info',
                description:
                  plan.kind === 'available'
                    ? 'All failed Acquisition Paths · no raw secrets or provider payloads'
                    : 'Unsupported Provider · no raw secrets or provider payloads',
                action: 'debug' as const,
              },
            ]
          : []),
      ];

      const selected = await vscode.window.showQuickPick<ProviderTroubleshootItem>(items, {
        title: `Lean Quota Monitor · Troubleshoot · ${configuredDisplayName(id, provider.displayNameFallback)}`,
        placeHolder:
          plan.kind === 'available'
            ? 'Set up any one method. Lean Quota Monitor uses the first one that works.'
            : 'This Provider is not supported on the current platform.',
        ignoreFocusOut: true,
      });
      if (!selected || selected.action === 'back') return;
      if (selected.action === 'debug') {
        await showRedactedDebugInfo(id);
        continue;
      }

      const method = selected.methodIndex === undefined ? undefined : methods[selected.methodIndex];
      if (!method) continue;
      const failure = state.error
        ? failureForMethod(state.error, method, methods.length)
        : undefined;
      const detail = failure
        ? [
            `Method: ${method.title}`,
            `Setup: ${method.setup}`,
            '',
            ...troubleshootLookupLines(method),
            '',
            ...redactedErrorLines(failure),
            `What to do: ${troubleshootAdvice(failure)}`,
          ].join('\n')
        : [
            `Method: ${method.title}`,
            `Setup: ${method.setup}`,
            '',
            ...troubleshootLookupLines(method),
            '',
            'No current failure was recorded for this method.',
            'Run Refresh to check it again.',
          ].join('\n');
      if (method.lookup?.kind === 'secret-storage') {
        const action = builtInProvider(id).secret?.actionLabel ?? 'Set / Replace API Key';
        const selectedAction = await vscode.window.showInformationMessage(
          `Troubleshoot · ${method.title}`,
          { modal: true, detail },
          action,
        );
        if (selectedAction === action) {
          const changed = await setBuiltInSecret(id);
          if (changed && providerHasCurrentData(states[id])) return;
        }
        continue;
      }

      await vscode.window.showInformationMessage(`Troubleshoot · ${method.title}`, {
        modal: true,
        detail,
      });
    }
  }

  async function openTroubleshoot(): Promise<void> {
    for (;;) {
      const missing: TroubleshootItem[] = [];

      for (const { id, displayNameFallback } of PROVIDERS) {
        const state = states[id];
        if (!state.error) continue;
        const methods = troubleshootMethods(id);
        missing.push({
          label: configuredDisplayName(id, displayNameFallback),
          description:
            methods.length > 1
              ? providerErrorSummary(state.error)
              : `Error: ${displayError(state.error)}`,
          detail: `Select to inspect ${methods.length === 1 ? 'this method' : 'each method'} and its current error`,
          action: 'provider',
          providerId: id,
        });
      }

      for (const [name, config] of Object.entries(configuredCustomProviders())) {
        const state = customStates[name] ?? {};
        if (!state.error) continue;
        missing.push({
          label: name,
          description: `Custom Provider · Error: ${displayError(state.error)}`,
          detail: `Script Path: ${config.script}`,
          action: 'custom-edit',
          customName: name,
        });
      }

      const selected = await vscode.window.showQuickPick<TroubleshootItem>(
        [
          { label: '$(arrow-left) Back', action: 'back', alwaysShow: true },
          ...(missing.length > 0
            ? missing
            : [{ label: 'No provider errors', kind: vscode.QuickPickItemKind.Separator }]),
        ],
        {
          title: 'Lean Quota Monitor · Troubleshoot',
          placeHolder: 'Choose a Provider to inspect its setup methods and current errors.',
          ignoreFocusOut: true,
        },
      );
      if (!selected || selected.action === 'back') return;
      if (!selected.action) return;
      if (selected.action === 'provider' && selected.providerId) {
        await openBuiltInTroubleshoot(selected.providerId);
        continue;
      }
      if (selected.action === 'custom-edit' && selected.customName) {
        await openCustomProvider(selected.customName);
      }
    }
  }

  async function openConfigure(): Promise<void> {
    for (;;) {
      const selected = await vscode.window.showQuickPick(buildConfigureItems(), {
        title: 'Lean Quota Monitor · Configure',
        placeHolder: 'Choose a Provider or configuration action',
        ignoreFocusOut: true,
      });
      if (!selected) return;
      if (selected.action === 'back') {
        openMonitor();
        return;
      }
      if (
        selected.action === 'builtin' &&
        selected.providerKey &&
        isProviderId(selected.providerKey)
      ) {
        await openBuiltInProvider(selected.providerKey);
        continue;
      }
      if (
        selected.action === 'custom' &&
        selected.providerKey &&
        !isProviderId(selected.providerKey)
      ) {
        await openCustomProvider(selected.providerKey);
        continue;
      }
      if (selected.action === 'add-custom') {
        await addCustomProvider();
        continue;
      }
      if (selected.action === 'troubleshoot') {
        await openTroubleshoot();
        continue;
      }
      if (selected.action === 'open-settings') {
        await vscode.commands.executeCommand(
          'workbench.action.openSettings',
          '@ext:nicezic.lean-quota-monitor',
        );
        return;
      }
    }
  }

  function openMonitor(): void {
    if (activeQuickPick) {
      activeQuickPick.show();
      return;
    }

    const qp = vscode.window.createQuickPick<MonitorItem>();
    activeQuickPick = qp;
    qp.title = 'Lean Quota Monitor';
    qp.placeholder = 'Choose a Provider or action';
    qp.matchOnDescription = true;
    qp.matchOnDetail = true;
    qp.items = buildMonitorItems();

    let disposed = false;
    const refreshQuickPickItems = () => {
      if (!disposed) qp.items = buildMonitorItems();
    };
    const hideForNavigation = () => {
      if (activeQuickPick === qp) activeQuickPick = undefined;
      qp.hide();
    };

    qp.onDidTriggerItemButton(async (event) => {
      const selected = event.item;
      if (selected.action === 'builtin' && selected.providerId) {
        await refreshBuiltIn(selected.providerId);
      } else if (selected.action === 'custom' && selected.customName) {
        const custom = configuredCustomProviders()[selected.customName];
        if (custom) await refreshCustom(selected.customName, custom);
      }
      refreshQuickPickItems();
    });

    qp.onDidAccept(async () => {
      const selected = qp.selectedItems[0];
      if (!selected) return;

      if (selected.action === 'refresh-all') {
        qp.selectedItems = [];
        await refresh();
        refreshQuickPickItems();
        return;
      }
      if (selected.action === 'close') {
        qp.hide();
        return;
      }
      hideForNavigation();
      if (selected.action === 'configure') {
        await openConfigure();
        return;
      }
      if (selected.action === 'builtin' && selected.providerId) {
        await openBuiltInProvider(selected.providerId);
        openMonitor();
        return;
      }
      if (selected.action === 'custom' && selected.customName) {
        await openCustomProvider(selected.customName);
        openMonitor();
      }
    });

    qp.onDidHide(() => {
      disposed = true;
      if (activeQuickPick === qp) activeQuickPick = undefined;
      qp.dispose();
    });
    qp.show();
  }

  const startTimer = () => {
    if (refreshTimer) clearInterval(refreshTimer);
    const seconds = vscode.workspace
      .getConfiguration('leanQuotaMonitor')
      .get<number>('refreshIntervalSeconds', 300);
    refreshTimer = setInterval(() => void refresh(), seconds * 1000);
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('leanQuotaMonitor.openMonitor', openMonitor),
    vscode.commands.registerCommand(
      'leanQuotaMonitor.openTroubleshoot',
      () => void openTroubleshoot(),
    ),
    vscode.commands.registerCommand('leanQuotaMonitor.refresh', refresh),
    vscode.commands.registerCommand(
      'leanQuotaMonitor.moveProvider',
      async (key: string, direction: MoveDirection) => {
        if (direction !== 'up' && direction !== 'down') return;
        await moveProviderOrder(key, direction);
      },
    ),

    vscode.commands.registerCommand('leanQuotaMonitor.openSettings', () =>
      vscode.commands.executeCommand(
        'workbench.action.openSettings',
        '@ext:nicezic.lean-quota-monitor',
      ),
    ),
    vscode.commands.registerCommand('leanQuotaMonitor.toggleProvider', async (key: string) => {
      await toggleProviderVisibility(key);
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('leanQuotaMonitor.refreshIntervalSeconds')) startTimer();
      if (event.affectsConfiguration('leanQuotaMonitor.providerOrder')) render();
      if (event.affectsConfiguration('leanQuotaMonitor.customProviders')) {
        render();
        void refreshConfiguredCustoms();
      }
      if (
        event.affectsConfiguration('leanQuotaMonitor.openaiLabel') ||
        event.affectsConfiguration('leanQuotaMonitor.anthropicLabel') ||
        event.affectsConfiguration('leanQuotaMonitor.geminiLabel') ||
        event.affectsConfiguration('leanQuotaMonitor.minimaxLabel') ||
        event.affectsConfiguration('leanQuotaMonitor.kimiLabel') ||
        event.affectsConfiguration('leanQuotaMonitor.zaiLabel') ||
        event.affectsConfiguration('leanQuotaMonitor.openrouterLabel') ||
        event.affectsConfiguration('leanQuotaMonitor.openaiName') ||
        event.affectsConfiguration('leanQuotaMonitor.anthropicName') ||
        event.affectsConfiguration('leanQuotaMonitor.geminiName') ||
        event.affectsConfiguration('leanQuotaMonitor.minimaxName') ||
        event.affectsConfiguration('leanQuotaMonitor.kimiName') ||
        event.affectsConfiguration('leanQuotaMonitor.zaiName') ||
        event.affectsConfiguration('leanQuotaMonitor.openrouterName') ||
        event.affectsConfiguration('leanQuotaMonitor.openaiVisible') ||
        event.affectsConfiguration('leanQuotaMonitor.anthropicVisible') ||
        event.affectsConfiguration('leanQuotaMonitor.geminiVisible') ||
        event.affectsConfiguration('leanQuotaMonitor.minimaxVisible') ||
        event.affectsConfiguration('leanQuotaMonitor.kimiVisible') ||
        event.affectsConfiguration('leanQuotaMonitor.zaiVisible') ||
        event.affectsConfiguration('leanQuotaMonitor.openrouterVisible')
      ) {
        render();
      }
    }),
  );

  startTimer();
  displayTimer = setInterval(render, 30_000);
  void refresh();
}

export function deactivate(): void {
  if (refreshTimer) clearInterval(refreshTimer);
  if (displayTimer) clearInterval(displayTimer);
}
