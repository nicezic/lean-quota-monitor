# ADR 0002: Providers own acquisition paths and recovery information

- Status: Accepted
- Date: 2026-08-19

## Decision

Each Built-in Provider owns its **acquisition paths, platform-specific differences, and Troubleshoot information** together.

```text
Provider
├─ Acquisition Paths
├─ Platform differences
└─ Troubleshoot
```

A shared platform layer does not implement Provider-specific behavior.

```text
Extension Host platform
        ↓ input
     Provider
        ↓
chooses its acquisition paths
```

When a Provider supports multiple acquisition paths, it defines the verified paths in priority order and uses the first successful result.

```text
Acquisition Paths
├─ [0] first verified path ── success → use
├─ [1] next verified path  ── success → use
└─ [n] next verified path

path fails      → try next path
all paths fail  → Provider Error
```

Later paths are still normal supported paths. Do not model them as a separate Primary / Fallback structure.

## Why

When one Provider's acquisition and recovery behavior is split across shared layers, changing that Provider requires several definitions to stay synchronized.

```text
Before
Provider behavior
├─ Provider code
├─ Platform Adapter
└─ Troubleshoot definition
        ↓
change several places
        ↓
definitions can drift

Now
Provider
├─ acquisition paths
├─ platform differences
└─ recovery information
        ↓
change around the Provider
```

Keeping related behavior with the Provider makes the change boundary clear and keeps the actual acquisition paths and recovery guidance aligned.
