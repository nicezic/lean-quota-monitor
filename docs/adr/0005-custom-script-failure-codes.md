# ADR 0005: Custom script failures use stable SCRIPT_* codes

- Status: Accepted
- Date: 2026-08-24

## Decision

Custom Provider script failures are classified as a structured `ProviderError` and flow through the same diagnostic pipeline as Built-in Providers.

```text
script failure
├─ executable not found              → SCRIPT_NOT_FOUND
├─ abnormal exit or killed           → SCRIPT_FAILED
└─ stdout not one non-empty line     → SCRIPT_BAD_OUTPUT
```

Failure detail carries exit code or signal only. Raw stderr is never collected.

The Status Output itself stays opaque. Custom Providers remain outside the acquisition contract (see ADR 0001); only their diagnostics join the shared pipeline.

## Why

An Errored Provider should look the same to the product regardless of Provider kind. Before this decision, Built-in failures carried stable codes while Custom failures appeared as unclassified error strings.

Raw stderr can contain credential-like output from arbitrary user scripts. Keeping detail to exit code or signal makes Redacted Debug Info true by construction instead of relying on later scrubbing.
