import * as fs from 'node:fs';
import * as path from 'node:path';
import process from 'node:process';
import * as vscode from 'vscode';
import { AcquisitionPathsError } from './acquisition.ts';
import {
  builtInProvider,
  isBuiltInProviderId as isProviderId,
  BUILT_IN_PROVIDERS as PROVIDERS,
} from './built-in-provider.ts';
import type { CustomProviderConfig, CustomProviderMap } from './custom-provider.ts';
import {
  configuredAlignment,
  configuredAlignmentSetting,
  configuredCustomProviders,
  configuredProviderName,
  configuredProviderOrder,
  configuredStatusBarName,
  lowQuotaWarningThreshold,
  providerPrimaryWindow,
  providerVisible,
  refreshIntervalSeconds,
  updateCustomProviders,
  updateLowQuotaWarningThreshold,
  updateMonitorSetting,
  updateProviderOrder,
  updateProviderPrimaryWindow,
  updateRefreshIntervalSeconds,
} from './monitor-config.ts';
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
  quickProviderPrefix,
} from './monitor-presentation.ts';
import {
  type ProviderPlan,
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
} from './provider-order.ts';
import type { ConcurrentRefreshPolicy } from './refresh-coordinator.ts';
import type { ProviderId, WindowType } from './types.ts';

const PROVIDER_SUPPORTED_WINDOWS: Partial<Record<ProviderId, readonly WindowType[]>> = {
  openai: ['5hour', '1week'],
  anthropic: ['5hour', '1week'],
  gemini: ['5hour', '1week'],
  minimax: ['5hour', '1week'],
  kimi: ['5hour', '1week'],
  zai: ['5hour', '1week'],
  opencode: ['5hour', '1week', '1month'],
};

const WINDOW_DESCRIPTIONS: Record<WindowType, string> = {
  '5hour': '5-hour reset window (5h)',
  '1day': '1-day reset window (1d)',
  '1week': '1-week reset window (1w)',
  '1month': '1-month reset window (1m)',
};

type MonitorItem = vscode.QuickPickItem & {
  action?:
    | 'builtin'
    | 'custom'
    | 'add-custom'
    | 'refresh-interval'
    | 'warning-threshold'
    | 'alignment'
    | 'troubleshoot'
    | 'close';
  providerId?: ProviderId;
  customName?: string;
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

const formatIntervalLabel = (seconds: number): string => {
  if (seconds < 60) return `${seconds}s`;
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};

const resolvedProviderOrder = (
  customProviders: CustomProviderMap,
  orderOverride?: readonly string[],
): string[] =>
  orderOverride
    ? normalizeProviderOrder(orderOverride, [
        ...PROVIDERS.map(({ id }) => id),
        ...Object.keys(customProviders),
      ])
    : configuredProviderOrder(customProviders);

const keyVisible = (
  key: string,
  customProviders: CustomProviderMap,
  override?: ReadonlyMap<string, boolean>,
): boolean =>
  override?.get(key) ??
  (isProviderId(key) ? providerVisible(key) : (customProviders[key]?.visible ?? true));

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

const promptText = async (
  title: string,
  value: string,
  prompt: string,
  placeHolder: string,
): Promise<string | undefined> =>
  (
    await vscode.window.showInputBox({ title, value, prompt, placeHolder, ignoreFocusOut: true })
  )?.trim();

export interface MonitorUIDeps {
  context: vscode.ExtensionContext;
  states: Record<ProviderId, ProviderState>;
  customStates: Record<string, CustomProviderState>;
  providerPlans: Record<ProviderId, ProviderPlan>;
  refreshBuiltIn: (id: ProviderId, policy?: ConcurrentRefreshPolicy) => Promise<void>;
  refreshCustom: (
    name: string,
    config: CustomProviderConfig,
    policy?: ConcurrentRefreshPolicy,
  ) => Promise<void>;
}

export function createMonitorUI(deps: MonitorUIDeps) {
  const { context, states, customStates, providerPlans, refreshBuiltIn, refreshCustom } = deps;
  const troubleshootMethods = (id: ProviderId): readonly ProviderTroubleshootMethod[] =>
    providerTroubleshootMethods(providerPlans[id]);
  const hasData = (key: string): boolean =>
    isProviderId(key)
      ? providerHasCurrentData(states[key])
      : customHasCurrentData(customStates[key] ?? {});

  let item = vscode.window.createStatusBarItem(
    'leanQuotaMonitor.summary',
    configuredAlignment(),
    10_000,
  );
  item.name = 'Lean Quota Monitor';
  item.command = 'leanQuotaMonitor.openMonitor';
  context.subscriptions.push(item);
  let activeQuickPick: vscode.QuickPick<MonitorItem> | undefined;

  const updateStatusBarAlignment = () => {
    const currentText = item.text;
    const currentTooltip = item.tooltip;
    item.dispose();
    item = vscode.window.createStatusBarItem(
      'leanQuotaMonitor.summary',
      configuredAlignment(),
      10_000,
    );
    item.name = 'Lean Quota Monitor';
    item.command = 'leanQuotaMonitor.openMonitor';
    item.text = currentText;
    item.tooltip = currentTooltip;
    item.show();
    context.subscriptions.push(item);
  };

  const refreshStatusVisibility = async () => {
    item.hide();
    await new Promise((resolve) => setTimeout(resolve, 0));
    item.show();
  };

  const tooltip = (
    orderOverride?: readonly string[],
    visibilityOverride?: ReadonlyMap<string, boolean>,
  ): vscode.MarkdownString => {
    const md = new vscode.MarkdownString(undefined, true);
    md.isTrusted = {
      enabledCommands: [
        'leanQuotaMonitor.toggleProvider',
        'leanQuotaMonitor.refresh',
        'leanQuotaMonitor.refreshProvider',
        'leanQuotaMonitor.openMonitor',
        'leanQuotaMonitor.openTroubleshoot',
        'leanQuotaMonitor.openSettings',
        'leanQuotaMonitor.moveProvider',
      ],
    };

    const customProviders = configuredCustomProviders();
    const order = resolvedProviderOrder(customProviders, orderOverride);
    const healthyOrder = order.filter(hasData);

    const sections: { key: string; block: string; updated: string }[] = [];
    for (const key of healthyOrder) {
      if (isProviderId(key)) {
        const provider = builtInProvider(key);
        const detail = providerDetail(
          configuredProviderName(key, provider.providerName),
          configuredStatusBarName(key, provider.statusBarName),
          states[key],
          providerPrimaryWindow(key),
          lowQuotaWarningThreshold(),
        );
        sections.push({ key, ...detail });
        continue;
      }
      const config = customProviders[key];
      if (!config) continue;
      const detail = customDetail(key, customStates[key] ?? {}, Date.now(), config.statusBarName);
      sections.push({ key, ...detail });
    }

    sections.forEach((detail, index) => {
      const visible = keyVisible(detail.key, customProviders, visibilityOverride);
      const visibilityStatus = visible ? 'Showing' : 'Hiding';
      const refreshLabel = detail.updated ? `🔄 ${detail.updated}` : '🔄';
      const controls: string[] = [
        commandLink('leanQuotaMonitor.toggleProvider', `👀 ${visibilityStatus}`, [detail.key]),
      ];
      if (index > 0) {
        controls.push(commandLink('leanQuotaMonitor.moveProvider', '⏶', [detail.key, 'up']));
      }
      if (index < sections.length - 1) {
        controls.push(commandLink('leanQuotaMonitor.moveProvider', '⏷', [detail.key, 'down']));
      }
      controls.push(commandLink('leanQuotaMonitor.refreshProvider', refreshLabel, [detail.key]));
      const controlBar = controls.join(' | ');
      if (detail.block.includes('\n')) {
        const [line1, line2] = detail.block.split('\n');
        md.appendMarkdown(`${line1}  \n${line2} | ${controlBar}  \n`);
      } else {
        md.appendMarkdown(`${detail.block} | ${controlBar}  \n`);
      }
      if (index < sections.length - 1) md.appendMarkdown('\n\n---\n\n');
    });

    const quickConfigLink = commandLink('leanQuotaMonitor.openMonitor', '🎚️ Quick Configure');
    const settingsLink = commandLink('leanQuotaMonitor.openSettings', '⚙️ Settings');
    const troubleshootLink = commandLink('leanQuotaMonitor.openTroubleshoot', '📋 Troubleshoot');
    const refreshLink = commandLink('leanQuotaMonitor.refresh', '🔄 Refresh All');
    if (sections.length > 0) md.appendMarkdown('\n\n---\n\n');
    md.appendMarkdown(
      `${quickConfigLink} | ${settingsLink} | ${troubleshootLink} | ${refreshLink}`,
    );

    return md;
  };

  const render = (
    orderOverride?: readonly string[],
    visibilityOverride?: ReadonlyMap<string, boolean>,
  ) => {
    const customProviders = configuredCustomProviders();
    const order = resolvedProviderOrder(customProviders, orderOverride);
    const visibleText: string[] = [];

    for (const key of order) {
      if (isProviderId(key)) {
        if (!keyVisible(key, customProviders, visibilityOverride)) continue;
        const state = states[key];
        if (!providerHasCurrentData(state)) continue;
        const provider = builtInProvider(key);
        visibleText.push(
          providerStatusText(
            configuredStatusBarName(key, provider.statusBarName),
            state,
            providerPrimaryWindow(key),
            lowQuotaWarningThreshold(),
          ),
        );
        continue;
      }
      const config = customProviders[key];
      const state = customStates[key] ?? {};
      if (!config || !keyVisible(key, customProviders, visibilityOverride)) continue;
      if (!customHasCurrentData(state)) continue;
      visibleText.push(customStatusText(config, state));
    }

    item.text = visibleText.length > 0 ? visibleText.join(' │ ') : 'Quota';
    item.tooltip = tooltip(order, visibilityOverride);

    if (activeQuickPick) {
      activeQuickPick.items = buildMonitorItems(order, visibilityOverride);
    }
  };

  const persistWithRender = async (
    update: PromiseLike<unknown>,
    orderOverride?: readonly string[],
    visibilityOverride?: ReadonlyMap<string, boolean>,
  ) => {
    render(orderOverride, visibilityOverride);
    await update;
    render(orderOverride, visibilityOverride);
    await refreshStatusVisibility();
  };

  const moveProviderOrder = async (key: string, direction: MoveDirection) => {
    const order = configuredProviderOrder();
    const nextOrder = moveProviderAmong(order, key, direction, order.filter(hasData));
    await persistWithRender(updateProviderOrder(nextOrder), nextOrder);
  };

  const toggleProviderVisibility = async (key: string) => {
    if (isProviderId(key)) {
      const nextVisible = !providerVisible(key);
      await persistWithRender(
        updateMonitorSetting(`${key}Visible`, nextVisible),
        undefined,
        new Map([[key, nextVisible]]),
      );
      return;
    }

    const current = configuredCustomProviders();
    const custom = current[key];
    if (!custom) return;
    const nextVisible = !custom.visible;
    await persistWithRender(
      updateCustomProviders({ ...current, [key]: { ...custom, visible: nextVisible } }),
      undefined,
      new Map([[key, nextVisible]]),
    );
  };

  const addCustomProvider = async () => {
    const current = configuredCustomProviders();
    let step: 'name' | 'statusBarName' | 'script' = 'name';
    let name = '';
    let statusBarName = '';
    let script = '';

    for (;;) {
      if (step === 'name') {
        const result = await showInputWithBack({
          title: 'Add Custom Provider · Provider Name',
          prompt: 'Name shown in Hover and Quick Pick.',
          placeholder: 'custom_provider_name',
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
        step = 'statusBarName';
        continue;
      }

      if (step === 'statusBarName') {
        const result = await showInputWithBack({
          title: 'Add Custom Provider · Status Bar Name',
          prompt: 'Short name shown before Status Output in the Status Bar.',
          placeholder: 'my',
          value: statusBarName,
          validate: (value) => (value ? undefined : 'Status Bar Name is required.'),
        });
        if (result.action === 'cancel') return;
        if (result.action === 'back') {
          step = 'name';
          continue;
        }
        statusBarName = result.value;
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
        step = 'statusBarName';
        continue;
      }
      script = result.value;
      break;
    }

    const custom = { statusBarName, script, visible: true };
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
        { label: '⬅️ Back', action: 'back' as const },
        {
          label: custom.visible ? '🙈 Hide from Status Bar' : '👁️ Show in Status Bar',
          description: custom.visible ? 'Showing' : 'Hiding',
          action: 'toggle' as const,
        },
        {
          label: '✏️ Change Provider Name',
          description: name,
          action: 'rename' as const,
        },
        {
          label: '🏷️ Change Status Bar Name',
          description: custom.statusBarName,
          action: 'label' as const,
        },
        {
          label: '📄 Change Script Path',
          description: custom.script,
          action: 'path' as const,
        },
        { label: '🗑️ Delete Custom Provider', action: 'delete' as const },
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
      const nextName = await promptText(
        `Provider Name · ${name}`,
        name,
        'Name shown in Hover and Quick Pick.',
        'custom_provider_name',
      );
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

    if (choice.action === 'label' || choice.action === 'path') {
      const field = choice.action === 'label' ? 'statusBarName' : 'script';
      const next = await promptText(
        `${field === 'statusBarName' ? 'Status Bar Name' : 'Script Path'} · ${name}`,
        custom[field],
        field === 'statusBarName'
          ? 'Label shown in Status Bar.'
          : 'Executable path only; no shell command or arguments.',
        field === 'statusBarName' ? 'my' : '~/.local/bin/my-provider-credit',
      );
      if (!next || next === custom[field]) return;
      if (field === 'script') customStates[name] = {};
      await updateCustomProviders({ ...current, [name]: { ...custom, [field]: next } });
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

  const setBuiltInSecret = async (id: ProviderId): Promise<boolean> => {
    const secret = builtInProvider(id).secret;
    if (!secret) return false;
    const displayName = configuredProviderName(id, builtInProvider(id).providerName);

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
    if (providerHasCurrentData(states[id])) {
      void vscode.window.showInformationMessage(`${displayName}: key stored · refresh OK`);
    } else {
      void vscode.window.showWarningMessage(
        `${displayName}: key stored · refresh failed: ${providerErrorSummary(
          states[id].error ?? new Error('Unknown error'),
        )}`,
      );
    }
    return true;
  };

  const updateBuiltInTextSetting = async (
    id: ProviderId,
    field: 'ProviderName' | 'StatusBarName',
    currentValue: string,
    title: string,
    defaultValue?: string,
  ): Promise<void> => {
    const defaultSuffix = defaultValue ? ` (default: ${defaultValue})` : '';
    const value = await vscode.window.showInputBox({
      title,
      value: currentValue,
      prompt:
        field === 'ProviderName'
          ? `Name shown in Hover and Quick Pick${defaultSuffix}.`
          : `Label shown in Status Bar${defaultSuffix}.`,
      placeHolder: defaultValue ?? currentValue,
      ignoreFocusOut: true,
    });
    const next = value?.trim();
    if (!next || next === currentValue) return;
    await updateMonitorSetting(`${id}${field}`, next);
    render();
  };

  const showRedactedDebugInfo = async (id: ProviderId): Promise<void> => {
    const state = states[id];
    if (!state.error) return;
    const provider = builtInProvider(id);
    const displayName = configuredProviderName(id, provider.providerName);
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
      | 'primary-window'
      | 'secret'
      | 'troubleshoot';

    for (;;) {
      const visible = providerVisible(id);
      const items: (vscode.QuickPickItem & { action: BuiltInAction })[] = [
        { label: '⬅️ Back', action: 'back', alwaysShow: true },
        {
          label: visible ? '🙈 Hide from Status Bar' : '👁️ Show in Status Bar',
          description: visible ? 'Showing' : 'Hiding',
          action: 'toggle',
        },
        {
          label: '✏️ Change Provider Name',
          description: configuredProviderName(id, provider.providerName),
          action: 'name',
        },
        {
          label: '🏷️ Change Status Bar Name',
          description: configuredStatusBarName(id, provider.statusBarName),
          action: 'label',
        },
      ];

      if (id in PROVIDER_SUPPORTED_WINDOWS) {
        const currentWindow = providerPrimaryWindow(id);
        const windowDesc = currentWindow ?? 'auto (Default: Longest)';
        items.push({
          label: '📅 Default Quota Window On Status Bar',
          description: windowDesc,
          action: 'primary-window',
        });
      }

      const secret = provider.secret;
      if (secret) {
        const keyConfigured = (await context.secrets.get(secret.storageKey)) !== undefined;
        items.push({
          label: `🔑 ${secret.actionLabel}`,
          description: `${secret.menuDescription} · ${keyConfigured ? 'Configured' : 'Not configured'}`,
          action: 'secret',
        });
      }
      if (states[id].error) {
        items.push({
          label: '📋 Troubleshoot',
          description: providerErrorSummary(states[id].error),
          action: 'troubleshoot',
        });
      }

      const selected = await vscode.window.showQuickPick(items, {
        title: `Lean Quota Monitor · ${configuredProviderName(id, provider.providerName)}`,
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
          'ProviderName',
          configuredProviderName(id, provider.providerName),
          `Provider Name · ${configuredProviderName(id, provider.providerName)}`,
          provider.providerName,
        );
        continue;
      }
      if (selected.action === 'label') {
        await updateBuiltInTextSetting(
          id,
          'StatusBarName',
          configuredStatusBarName(id, provider.statusBarName),
          `Status Bar Name · ${configuredProviderName(id, provider.providerName)}`,
          provider.statusBarName,
        );
        continue;
      }
      if (selected.action === 'primary-window') {
        await openPrimaryWindowPicker(id);
        continue;
      }
      if (selected.action === 'secret') {
        await setBuiltInSecret(id);
        continue;
      }
      await openBuiltInTroubleshoot(id);
    }
  };

  async function openRefreshIntervalPicker(): Promise<void> {
    const presets = [30, 60, 120, 180, 300, 600, 1800, 3600];
    const validSeconds = (input: string): number | undefined => {
      const parsed = Number(input);
      return Number.isInteger(parsed) && parsed >= 30 ? parsed : undefined;
    };
    const current = refreshIntervalSeconds();
    const items: (vscode.QuickPickItem & { seconds?: number; custom?: boolean })[] = [
      { label: '⬅️ Back', alwaysShow: true },
      ...presets.map((seconds) => ({
        label: formatIntervalLabel(seconds),
        description: `${seconds} seconds${seconds === current ? ' · current' : ''}`,
        seconds,
      })),
      { label: '✏️ Custom…', custom: true, alwaysShow: true },
    ];

    for (;;) {
      const selected = await vscode.window.showQuickPick(items, {
        title: 'Lean Quota Monitor · Refresh Interval',
        placeHolder: 'How often all Providers refresh automatically.',
        ignoreFocusOut: true,
      });
      if (!selected) return;
      if (selected.seconds !== undefined) {
        if (selected.seconds !== current) await updateRefreshIntervalSeconds(selected.seconds);
        return;
      }
      if (!selected.custom) return;

      const result = await showInputWithBack({
        title: 'Refresh Interval · seconds',
        prompt: 'Whole number of at least 30 seconds (default: 180s).',
        placeholder: '180',
        validate: (input) => {
          if (validSeconds(input) === undefined) {
            return 'Enter a whole number of at least 30 seconds.';
          }
          return undefined;
        },
      });
      if (result.action !== 'accept') return;
      const parsed = validSeconds(result.value);
      if (parsed !== undefined) {
        if (parsed !== current) await updateRefreshIntervalSeconds(parsed);
        return;
      }
    }
  }

  async function openPrimaryWindowPicker(id: ProviderId): Promise<void> {
    const supported = PROVIDER_SUPPORTED_WINDOWS[id];
    if (!supported || supported.length === 0) return;
    const provider = builtInProvider(id);
    const currentWindow = providerPrimaryWindow(id);

    const items: (vscode.QuickPickItem & { value?: string })[] = [
      { label: '⬅️ Back', alwaysShow: true },
      {
        label: 'auto (Default: Longest)',
        description: `Show longest duration window${currentWindow === undefined ? ' · Current' : ''}`,
        value: 'auto',
      },
      ...supported.map((window) => ({
        label: window,
        description: `${WINDOW_DESCRIPTIONS[window]}${currentWindow === window ? ' · Current' : ''}`,
        value: window,
      })),
    ];

    const selected = await vscode.window.showQuickPick(items, {
      title: `${configuredProviderName(id, provider.providerName)} · Default Quota Window`,
      placeHolder: 'Default Quota Window On Status Bar',
      ignoreFocusOut: true,
    });
    if (!selected?.value) return;
    if (selected.value !== (currentWindow ?? 'auto')) {
      await updateProviderPrimaryWindow(id, selected.value);
      render();
    }
  }

  async function openLowQuotaWarningPicker(): Promise<void> {
    const presets: { value: string; label: string; description: string }[] = [
      { value: '20%', label: '20% (Default)', description: 'Recommended threshold' },
      { value: 'off', label: 'Off', description: 'Disable warning; keep default window' },
      { value: '5%', label: '5%', description: 'Warn at ≤ 5% remaining' },
      { value: '10%', label: '10%', description: 'Warn at ≤ 10% remaining' },
      { value: '15%', label: '15%', description: 'Warn at ≤ 15% remaining' },
      { value: '25%', label: '25%', description: 'Warn at ≤ 25% remaining' },
      { value: '30%', label: '30%', description: 'Warn at ≤ 30% remaining' },
      { value: '40%', label: '40%', description: 'Warn at ≤ 40% remaining' },
      { value: '50%', label: '50%', description: 'Warn at ≤ 50% remaining' },
      { value: '60%', label: '60%', description: 'Warn at ≤ 60% remaining' },
    ];
    const current = lowQuotaWarningThreshold();
    const currentStr = current === null ? 'off' : `${current}%`;

    const items: (vscode.QuickPickItem & { value?: string })[] = [
      { label: '⬅️ Back', alwaysShow: true },
      ...presets.map((p) => ({
        label: p.label,
        description: `${p.description}${p.value === currentStr ? ' · Current' : ''}`,
        value: p.value,
      })),
    ];

    const selected = await vscode.window.showQuickPick(items, {
      title: '⚠️ Low Quota Warning Threshold',
      placeHolder: 'Status Bar warning (⚠️) trigger threshold',
      ignoreFocusOut: true,
    });
    if (!selected?.value) return;
    if (selected.value !== currentStr) {
      await updateLowQuotaWarningThreshold(selected.value);
      render();
    }
  }

  async function openBuiltInTroubleshoot(id: ProviderId): Promise<'fixed' | undefined> {
    const provider = builtInProvider(id);
    const plan = providerPlans[id];

    for (;;) {
      const state = states[id];
      const methods = troubleshootMethods(id);
      const items: ProviderTroubleshootItem[] = [
        { label: '⬅️ Back', action: 'back', alwaysShow: true },
        ...methods.map((candidate, index) => {
          const failure = state.error
            ? failureForMethod(state.error, candidate, methods.length)
            : undefined;
          return {
            label: `${failure ? '❌' : '✅'} ${index + 1}. ${candidate.title}`,
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
                label: '🐛 Redacted Debug Info',
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
        title: `Lean Quota Monitor · Troubleshoot · ${configuredProviderName(id, provider.providerName)}`,
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
          if (changed && providerHasCurrentData(states[id])) return 'fixed';
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

      for (const { id, providerName } of PROVIDERS) {
        const state = states[id];
        if (!state.error) continue;
        const methods = troubleshootMethods(id);
        missing.push({
          label: configuredProviderName(id, providerName),
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
          { label: '⬅️ Back', action: 'back', alwaysShow: true },
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
        const fixed = await openBuiltInTroubleshoot(selected.providerId);
        if (fixed === 'fixed') {
          const remaining =
            PROVIDERS.some(({ id }) => states[id].error) ||
            Object.keys(configuredCustomProviders()).some((name) => customStates[name]?.error);
          if (!remaining) return;
        }
        continue;
      }
      if (selected.action === 'custom-edit' && selected.customName) {
        await openCustomProvider(selected.customName);
      }
    }
  }

  const buildMonitorItems = (
    orderOverride?: readonly string[],
    visibilityOverride?: ReadonlyMap<string, boolean>,
  ): MonitorItem[] => {
    const items: MonitorItem[] = [];
    const customProviders = configuredCustomProviders();
    const order = resolvedProviderOrder(customProviders, orderOverride);

    items.push({ label: 'Built-in', kind: vscode.QuickPickItemKind.Separator });
    for (const key of order) {
      if (!isProviderId(key)) continue;
      const state = states[key];
      if (!providerHasCurrentData(state)) continue;
      const provider = builtInProvider(key);
      const primaryWindow = providerPrimaryWindow(key);
      const threshold = lowQuotaWarningThreshold();
      const prefix = quickProviderPrefix(state, primaryWindow, threshold);
      const visible = keyVisible(key, customProviders, visibilityOverride);
      const visibilityStatus = visible ? 'Showing' : 'Hiding';
      items.push({
        label: `${prefix ? `${prefix} ` : ''}${configuredProviderName(key, provider.providerName)}`,
        description: `${quickProviderDescription(state, primaryWindow, threshold)} · ${visibilityStatus}`,
        action: 'builtin',
        providerId: key,
        buttons: [{ iconPath: new vscode.ThemeIcon('refresh'), tooltip: 'Refresh now' }],
      });
    }

    items.push({ label: 'Custom', kind: vscode.QuickPickItemKind.Separator });
    for (const key of order) {
      if (isProviderId(key)) continue;
      const config = customProviders[key];
      const state = customStates[key] ?? {};
      if (!config) continue;
      const visible = keyVisible(key, customProviders, visibilityOverride);
      const visibilityStatus = visible ? 'Showing' : 'Hiding';
      const outputText = state.output ?? (state.error ? displayError(state.error) : 'Loading…');
      items.push({
        label: `[custom] ${key}`,
        description: `${outputText} · ${visibilityStatus}`,
        action: 'custom',
        customName: key,
        buttons: [{ iconPath: new vscode.ThemeIcon('refresh'), tooltip: 'Refresh now' }],
      });
    }

    items.push({
      label: '➕ Add Custom Provider',
      action: 'add-custom',
      alwaysShow: true,
    });
    items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
    const currentInterval = refreshIntervalSeconds();
    items.push({
      label: '🎚️ Refresh Interval',
      description: `${currentInterval}s (${formatIntervalLabel(currentInterval)})`,
      action: 'refresh-interval',
      alwaysShow: true,
    });
    const currentThreshold = lowQuotaWarningThreshold();
    const thresholdDesc =
      currentThreshold === null
        ? 'Off'
        : currentThreshold === 20
          ? '20% (Default)'
          : `${currentThreshold}%`;
    items.push({
      label: '⚠️ Low Quota Warning Threshold',
      description: thresholdDesc,
      action: 'warning-threshold',
      alwaysShow: true,
    });
    items.push({
      label: '⚙️ Status Bar Alignment',
      description: `${configuredAlignmentSetting() === 'left' ? 'Left' : 'Right'} (restart required)`,
      action: 'alignment',
      alwaysShow: true,
    });
    items.push({
      label: '📋 Troubleshoot Providers',
      action: 'troubleshoot',
      alwaysShow: true,
    });
    items.push({ label: '❌ Close', action: 'close', alwaysShow: true });
    return items;
  };

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

      if (selected.action === 'close') {
        qp.hide();
        return;
      }
      hideForNavigation();
      if (selected.action === 'troubleshoot') {
        await openTroubleshoot();
      } else if (selected.action === 'add-custom') {
        await addCustomProvider();
      } else if (selected.action === 'refresh-interval') {
        await openRefreshIntervalPicker();
      } else if (selected.action === 'warning-threshold') {
        await openLowQuotaWarningPicker();
      } else if (selected.action === 'alignment') {
        const next = configuredAlignmentSetting() === 'left' ? 'right' : 'left';
        await updateMonitorSetting('statusBarAlignment', next);
      } else if (selected.action === 'builtin' && selected.providerId) {
        await openBuiltInProvider(selected.providerId);
      } else if (selected.action === 'custom' && selected.customName) {
        await openCustomProvider(selected.customName);
      } else {
        return;
      }
      openMonitor();
    });

    qp.onDidHide(() => {
      disposed = true;
      if (activeQuickPick === qp) activeQuickPick = undefined;
      qp.dispose();
    });
    qp.show();
  }

  return {
    render,
    openMonitor,
    openTroubleshoot,
    toggleProviderVisibility,
    moveProviderOrder,
    refreshStatusVisibility,
    updateStatusBarAlignment,
    show: () => item.show(),
    statusText: () => item.text,
  };
}
