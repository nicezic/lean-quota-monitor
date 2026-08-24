# Lean Quota Monitor

**One status bar. All your AI quotas.**

Lean Quota Monitor is a small VS Code extension that keeps current AI subscription quota and credit state in the Status Bar. Provider acquisition currently supports **Linux / Remote WSL**, **native Windows (Beta)**, and **macOS partial Beta** Extension Hosts. macOS currently supports Codex and AGY; Claude subscription quota is not enabled there because Claude Code stores its credentials in macOS Keychain.

![Lean Quota Monitor](.github/assets/lean-quota-monitor.png)

```text
GPT 99% ↻6d │ AGY 98% ↻3d │ M3 99% ↻23h │ OR $74.75
```

Quota providers show the **Weekly remaining percentage** and reset countdown. Credit providers show **Remaining Credit**.

## Built-in Providers

| Company | Provider | Status Bar | Setup authority | Etc |
| --- | --- | --- | --- | --- |
| OpenAI | Codex | `GPT` | Local Codex login | 5h limit officially lifted for now |
| Anthropic | Claude | `CLA` | Local Claude Code OAuth login | |
| Google | Gemini / Antigravity | `AGY` | AGY CLI `/quota` | |
| MiniMax | Token Plan | `M3` | Token Plan API Key in VS Code SecretStorage | |
| Moonshot AI | Kimi Code | `KIMI` | Kimi Code API Key in VS Code SecretStorage | |
| Z.AI | GLM Coding Plan | `GLM` | Coding Plan API Key in VS Code SecretStorage | |
| OpenRouter | Credit | `OR` | Management Key in VS Code SecretStorage | |
| Anomaly | OpenCode Go | `OCG` | Go API Key in VS Code SecretStorage | 5h / Week / Month windows |

Exact acquisition and normalization contracts live in [`docs/provider-acquisition-spec.md`](docs/provider-acquisition-spec.md).

## Using the monitor

```text
Status Bar / Hover
→ current healthy values

Main Quick Pick
→ current working Built-ins + fast actions

Configure
→ current working Built-ins + Custom Provider management

Troubleshoot
→ first-time Built-in setup + recovery
```

A Built-in disappears from the live/management surfaces when its latest refresh fails and remains available in **Troubleshoot** until one acquisition path works again. A healthy Provider can still be hidden from the Status Bar with its visibility setting without disabling refresh.

Status Bar click itself is inert. Hover provides Quick Configure, Settings, Troubleshoot, Refresh, visibility, and ordering controls.

## Provider setup

For extension-owned keys, open **Troubleshoot**, choose the Provider and its setup method, then use the direct **Set / Replace Key** action.

| Provider | Setup method |
| --- | --- |
| MiniMax | MiniMax Token Plan API Key |
| Kimi | Kimi Code API Key |
| Z.AI / GLM | Z.AI Coding Plan API Key |
| OpenRouter | OpenRouter Management Key |
| OpenCode Go | OpenCode Go API Key |

The raw key is stored in VS Code `SecretStorage`; it is not written to normal settings or logs. Healthy key-backed Providers can also replace their key from Configure.

Codex, Claude, and AGY reuse their existing local login/CLI authority. Troubleshoot shows the actual file or executable lookup used by the current Extension Host.

Detailed recovery behavior is documented in [`docs/troubleshooting.md`](docs/troubleshooting.md).

## Custom Providers

Custom Providers are lightweight local status sources:

```text
Configure
→ Add Custom Provider
```

Each Custom Provider has:

```text
Provider Name
Status Bar Name
Script Path
```

The extension executes the Script Path directly with no shell command/argument parser. The script must exit successfully and write exactly one non-empty logical line to stdout. That line becomes the opaque **Status Output**.

```bash
echo '$12.30'
```

The Status Bar renders `Status Bar Name + Status Output` with a maximum combined length of 10 Unicode characters. Lean Quota Monitor does not infer quota, credit, currency, percentage, or other semantics from Custom Status Output. Custom Provider credentials remain owned by the script.

Generic examples are available under [`examples/custom-provider/`](examples/custom-provider/).

## Security

[SECURITY.md](./SECURITY.md)

## Contributing

- Human contributors: [`CONTRIBUTING.md`](CONTRIBUTING.md)
- Autonomous AI contributors: [`docs/contribution-prompt.md`](docs/contribution-prompt.md)

## Buy me a coffee ❤️

[GitHub Sponsors](https://github.com/sponsors/nicezic)
