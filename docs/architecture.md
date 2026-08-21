# Lean Quota Monitor Architecture

Lean Quota Monitor keeps provider acquisition, normalized provider state, and VS Code presentation separate. Built-in Providers own their acquisition behavior; the UI consumes normalized snapshots rather than provider-specific responses.

## Runtime

```text
VS Code UI
   ↕ VS Code API
Workspace Extension Host
   ↓
Built-in Provider plans / Custom scripts
   ↓
current provider state
   ↓
Status Bar / Hover / Quick Pick / Troubleshoot
```

The extension runs as a workspace extension. The active Extension Host determines `linux`, `win32`, or `darwin`; that platform value is passed to each Built-in Provider when its acquisition plan is created. Remote WSL therefore uses Linux behavior, while native Windows and macOS use their own host platform behavior. Claude subscription quota remains unsupported on macOS because the current provider does not extract its Keychain credential.

## Built-in Provider data model

Built-in Providers normalize successful acquisition into a `ProviderSnapshot`:

```text
ProviderSnapshot
├─ QuotaSnapshot
└─ CreditSnapshot
```

Quota and credit remain different snapshot kinds; credit is not converted into a percentage or reset window. Exact fields and normalization rules belong in [`provider-acquisition-spec.md`](provider-acquisition-spec.md).

## Built-in Provider ownership

Each Built-in Provider defines its own acquisition plan:

```text
BuiltInProviderDefinition
└─ snapshotPlan(context)
   └─ ProviderPlan
      ├─ available
      │  └─ ProviderPath[]
      │     ├─ acquire()
      │     └─ troubleshoot
      │
      └─ unsupported
         ├─ error
         └─ troubleshoot
```

`context` currently provides the Extension Host platform and access to extension-owned secrets. Platform is input to the Provider; it is not a separate acquisition owner.

An available plan contains one or more ordered `ProviderPath` values. Each path must produce the same normalized snapshot semantics for that Provider. Refresh tries them in order and stops at the first success; if all paths fail, the Provider is Errored. The successful path id is retained as `acquiredVia` for diagnostics.

Troubleshoot information is defined beside the acquisition method it describes. An unsupported plan has no Acquisition Path and instead exposes Provider-level recovery information directly.

SecretStorage-backed Providers use the shared `defineSecretProvider` helper, while Providers with local CLI/file or platform-specific behavior define `snapshotPlan` directly.

Exact credentials, requests, parser fields, timeouts, and normalization rules belong in [`provider-acquisition-spec.md`](provider-acquisition-spec.md).

## Custom Provider boundary

Custom Providers remain opaque executable status sources and do not produce `ProviderSnapshot` values:

```text
Provider Name
Status Bar Name
Script Path
   ↓ execFile(path, [])
Status Output
```

The extension does not infer whether Custom Provider output means quota, credit, balance, spend, or another status value.

## Provider visibility and recovery

```text
latest refresh success → Healthy Provider
latest refresh failure → Errored Provider
```

A prior success does not make a currently failing Provider healthy.

```text
Status Bar / Hover
→ Healthy Providers only

Main Quick Pick / Configure
→ Healthy Built-ins only
→ Custom Providers remain editable when errored

Troubleshoot
→ failed / not-yet-configured Built-ins
→ errored Custom Providers
→ setup and recovery
```

`visible=false` hides a Healthy Provider from the Status Bar only. Refresh continues and Hover remains available. Exact diagnostic behavior belongs in [`troubleshooting.md`](troubleshooting.md).

## Refresh flow

Built-in Provider plans are created during activation from the current Extension Host context and then shared by refresh and Troubleshoot.

```text
Activation
→ provider.snapshotPlan(context)
→ ProviderPlan

Built-in Refresh
→ acquireProviderPlan(plan)
→ ordered ProviderPath[]
→ first successful acquisition
→ ProviderSnapshot
→ ProviderState { acquiredVia }
→ Render

Built-in Troubleshoot
→ same ProviderPlan
→ path-specific methods or unsupported guidance

Custom Refresh
→ Script execution
→ Status Output
→ Custom Provider state
→ Render
```

`ProviderState` holds the current snapshot or current error plus update time. Provider refreshes are isolated so one failure does not prevent other Providers from updating.

Known Built-in failures may use a structured `ProviderError`; unknown failures remain unclassified until their meaning is verified. UI diagnostics retain controlled metadata rather than raw provider responses or process output.

## Source ownership

```text
src/types.ts
→ ProviderId / ProviderSnapshot / QuotaSnapshot / CreditSnapshot

src/provider-definition.ts
→ BuiltInProviderDefinition / ProviderPlan / ProviderPath / Troubleshoot contract

src/providers/*
→ provider fetch / parse / normalization / acquisition plan / Troubleshoot metadata

src/acquisition.ts
→ ordered ProviderPath execution / acquiredVia / ordered failures

src/platform.ts
→ Extension Host platform detection only

src/built-in-provider.ts
→ Built-in Provider registry and lookup

src/provider-error.ts
→ Built-in structured error contract

src/provider-order.ts
→ Provider order normalization / visible-order moves / rename and removal updates

src/refresh-coordinator.ts
→ concurrent refresh joining / state-changing rerun

src/monitor-presentation.ts
→ current-data predicates / Status Bar and detail formatting

src/custom-provider.ts
→ Custom Provider config / script execution contract

src/extension.ts
→ runtime composition / current state / VS Code UI
```
