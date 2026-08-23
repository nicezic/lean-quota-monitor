# Troubleshooting Contract

For an available Built-in Provider plan, Lean Quota Monitor diagnoses each Acquisition Path from three facts:

```text
Resource Type + Failure Type + Actual Lookup Target
```

This document owns the reusable troubleshooting model and UI contract. Exact Provider endpoints, credential schemas, parser fields, and normalization remain in [`provider-acquisition-spec.md`](provider-acquisition-spec.md).

## 1. Resource Type

### API

Check:

```text
credential source
endpoint
HTTP result
supported response shape
```

Typical failures:

```text
key missing / mistyped / revoked / expired
endpoint unavailable or moved
required plan missing
quota or credit exhausted
response schema changed
```

Authentication failure and endpoint failure are different problems. Do not present a rejected key as a server outage or an outage as an invalid key.

For extension-owned keys, Troubleshoot may show the VS Code `SecretStorage` key name, never its value.

### Executable

Check:

```text
command name
current Extension Host PATH
candidate executable paths
process result
```

Typical failures:

```text
program not installed
installed but not on PATH
unsupported command/version
program login required
process failure / timeout
```

Show only the useful result of the current Extension Host lookup:

```text
Executable PATH:
  /home/user/.local/bin/agy
```

If the command cannot be resolved:

```text
Executable: agy
Result: Not found in PATH
```

Do not dump every `PATH`/`PATHEXT` candidate into the UI.

### Credential File

Check:

```text
exact expanded file path
file existence
expected credential field
whether the credential is still accepted
```

Typical failures:

```text
program never installed/initialized
login never completed
credential file missing
configured home/path points elsewhere
token/key field missing
credential expired/revoked
credential-file schema changed
```

Show the actual path used by the Extension Host, not only shorthand such as `~/.codex/auth.json`:

```text
File PATH:
  /home/user/.codex/auth.json
```

## 2. Failure Type

Use a structured `ProviderError` only when the failure meaning is verified. Unknown HTTP, network, process, or provider-specific failures may remain unclassified.

Current stable codes:

```text
CLI_NOT_FOUND
AUTH_REQUIRED
KEY_MISSING
KEY_INVALID
PLAN_REQUIRED
QUOTA_EXHAUSTED
SCHEMA_CHANGED
```

Conceptually, failures fall into:

| Failure | Meaning |
| --- | --- |
| Missing | Required executable, file, key, or credential field does not exist |
| Invalid | Resource exists but is malformed, mistyped, revoked, or rejected |
| Expired | Previously valid credential is no longer accepted because of lifetime/expiry |
| Unavailable | Endpoint, network, or process cannot currently be reached/executed |
| Quota / Credit Exhausted | Authentication succeeded but usable allowance is zero |
| Plan Required | Account is authenticated but lacks the required product/plan |
| Schema Changed | Response exists but no supported normalized shape remains |

Do not guess. For example, a generic `401` is not automatically `Expired`, because it may also mean invalid/revoked credentials.

`SCHEMA_CHANGED` fails closed: do not guess new field positions, fabricate windows, or silently convert an unknown shape to zero.

## 3. Actual Lookup Target

Troubleshoot explains **where this Extension Host actually looked**.

```text
Credential File
→ exact expanded file PATH

Executable
→ resolved executable path, or `Not found in PATH`

SecretStorage-backed API
→ VS Code SecretStorage + storage key name
```

Lookup information always comes from the active VS Code Extension Host. In Remote WSL this means Linux paths; in native Windows Beta this means `%USERPROFILE%` and Windows PATH resolution; in macOS partial Beta it means macOS home paths and executable PATH resolution. Claude on macOS is an explicit exception: its subscription credential authority is macOS Keychain, which Lean Quota Monitor does not extract directly.

## Troubleshoot UX

Troubleshoot is organized around **ways to make the Provider work**, not exception stacks.

```text
Troubleshoot
→ Errored Built-in Provider
   → Setup Method 1
   → Setup Method 2
   → ...
   → Redacted Debug Info
```

When multiple equivalent Acquisition Paths exist:

```text
Set up any one method.
Lean Quota Monitor uses the first one that works.
```

For an available plan, selecting a method shows only that method's setup, actual lookup target, and current failure. **Each Setup Method shows exactly one Acquisition Path.** An aggregate Provider error may summarize that several paths failed, but it must never replace, merge, or rewrite an individual path failure. An unsupported plan has no Acquisition Path; Troubleshoot shows its Provider-level setup guidance directly. For SecretStorage-backed methods, the same method detail also offers the Set / Replace Key action so a failed or first-time Provider can be recovered without going through Configure.

Example:

```text
Codex
├─ 1. Codex login
│  ├─ File PATH: /home/user/.codex/auth.json
│  └─ AUTH_REQUIRED
│
├─ 2. Codex app-server
│  ├─ Executable: codex
│  ├─ Result: Not found in PATH
│  └─ CLI_NOT_FOUND
│
└─ Redacted Debug Info
```

An exhausted valid quota is a valid Provider snapshot with zero remaining allowance; it is not an acquisition failure merely because the value is zero.

### Codex: 5-hour limit not shown

[OpenAI Support confirmation](https://community.openai.com/t/has-the-5-hour-usage-session-been-removed-from-codex-cli/1387701/3) — The Codex 5-hour usage limit is temporarily lifted for Plus, Pro, and Business users, so weekly-only quota responses are currently expected.

## Security boundary

Troubleshooting must never expose:

```text
API key values
OAuth/access/refresh tokens
cookies
raw credential-file contents
raw provider response bodies
raw stdout/stderr collected only for debugging
```

Redacted Debug Info uses controlled metadata only:

```text
Provider
Acquisition Path id when applicable
ProviderError code
safe message/detail
updated time
```

The extension intentionally avoids collecting sensitive raw data and attempting to scrub it later.
