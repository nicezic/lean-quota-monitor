# ADR 0001: Live status and native management

- Status: Accepted
- Date: 2026-08-19

## Decision

A Provider is Healthy only when its latest refresh succeeds; after a failed refresh, the previous success is not shown as current health.

```text
latest refresh
├─ success → Healthy
│            ├─ visible=true  → Status Bar + Hover
│            └─ visible=false → Hover only
│
└─ failure → Troubleshoot
```

Failed or not-yet-configured Built-in Providers stay out of the normal live/configuration surfaces and remain reachable through Troubleshoot.

Use native VS Code surfaces while they are sufficient:

```text
Lean Quota Monitor
├─ Status Bar
├─ Hover
├─ Quick Pick
├─ Input Box
└─ Troubleshoot

Webview → not used
```

Custom Providers remain opaque executable status sources:

```text
Provider Name
+ Status Bar Name
+ Script Path
        ↓
   Status Output
```

The extension does not interpret Custom Provider output as quota, credit, balance, spend, or another domain value. The script keeps ownership of its credentials.

## Why

Showing the last success as current health would present stale status as live data. Keeping failed Providers in Troubleshoot keeps the monitor compact.

Native VS Code surfaces avoid a custom UI layer while they cover every interaction the monitor needs.
