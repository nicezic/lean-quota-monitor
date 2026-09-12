# Provider Acquisition Specification

This document is the **current contract for how Built-in Providers acquire and normalize monitor data**.

`README.md` explains the product, `architecture.md` explains the current structure, and ADRs explain durable architectural decisions. Provider-specific credential paths, requests, parsing, normalization, and failure rules belong here instead of being duplicated across those documents.

## Scope

Built-in providers:

- OpenAI Codex
- Anthropic Claude
- Google Gemini / Antigravity
- MiniMax Token Plan
- Kimi Code
- Z.AI / GLM Coding Plan
- OpenRouter Credit
- OpenCode Go

Custom Providers are intentionally outside this contract. They are opaque executable status sources and own their own credentials; see [`adr/0001-live-status-and-native-management.md`](adr/0001-live-status-and-native-management.md).

## Common normalized shape

Every successful Built-in Provider refresh returns a UI-neutral `ProviderSnapshot`:

```text
ProviderSnapshot
├─ QuotaSnapshot
│  ├─ statusType: WindowType
│  └─ windows[]
│     ├─ type: WindowType
│     ├─ usedPercent
│     ├─ remainingPercent
│     └─ resetAt?
│
└─ CreditSnapshot
   ├─ currency
   ├─ totalCredits
   ├─ usedCredits
   └─ remainingCredits
```

`QuotaSnapshot` represents reset-window subscription limits. Supported window types are strictly enumerated as `WindowType` (`'5hour' | '1day' | '1week' | '1month'`). The status bar presentation target is designated by `statusType`, determined via preemption rules (`remainingPercent <= 20%` elevates an urgent shorter window; otherwise provider primary window). `CreditSnapshot` represents monetary credit state; Remaining Credit is the primary product-facing credit metric. Credit is not converted into a percentage or reset window.

Implementation contract: `src/types.ts`. Codex, Claude, Gemini, MiniMax, Kimi, Z.AI, and OpenCode Go return `QuotaSnapshot`; OpenRouter returns `CreditSnapshot`.

A number must actually be present in the response. A missing value is never treated as zero:

```text
actual 0 / supported numeric "0" → valid zero
missing / null / blank             → invalid, never zero
NaN / non-numeric / out of range   → invalid, never zero
```

When a Provider section below documents **clamping** for a numeric field, the documented clamp replaces the out-of-range rejection for that field.

A valid zero remaining allowance is a successful snapshot and means the quota or credit is actually exhausted. It must not be confused with missing data. When a quota Provider exposes several supported windows, each window is normalized independently; the valid subset is retained, and `SCHEMA_CHANGED` is raised only when no supported valid window remains.

Acquisition is **current-data only**. Each Built-in Provider uses an ordered list of verified `Acquisition Paths`; a path is eligible only when it produces the same Provider Snapshot semantics. Refresh stops at the first successful path and becomes Errored only when every configured path fails. A previous successful snapshot does not make a currently failing Provider healthy. Live Status Bar/Hover presentation semantics are defined by ADR 0001.

Current `acquiredVia` path ids:

```text
Codex      codex-direct-api → codex-app-server
Claude     claude-oauth-api
Gemini     agy-cli
MiniMax    minimax-token-plan-api
Kimi       kimi-api-key
Z.AI       zai-quota-api
OpenRouter openrouter-credits-api
OpenCode   opencode-go-usage-api
```

These ids are runtime diagnostic metadata, not user-facing Provider identities.

### Extension-owned API keys

MiniMax, Kimi, Z.AI, OpenRouter, and OpenCode Go use API keys owned by this extension. Their setup flow is shared:

```text
Troubleshoot (first-time setup / recovery)
Configure (while Healthy)
  → masked key input
  → trim
  → VS Code SecretStorage
```

Raw key values are not stored in normal settings or rendered/logged. Each Provider section below defines the key type and Provider-specific acquisition contract.

---

## OpenAI Codex

Implementation: `src/providers/openai.ts`

### Credential authority

```text
$CODEX_HOME/auth.json
        or
~/.codex/auth.json

└─ tokens.access_token
└─ tokens.account_id?     optional
```

The extension reuses the credential produced by a local Codex login. It does not copy the token into VS Code settings or its own credential store. Linux/macOS use `~/.codex/auth.json` by default; native Windows uses `%USERPROFILE%\.codex\auth.json`. `CODEX_HOME` overrides the containing directory on all supported platforms.

### Quota request

```text
GET https://chatgpt.com/backend-api/wham/usage
Authorization: Bearer <access_token>
chatgpt-account-id: <account_id>   # when present
```

HTTP timeout: 15 seconds.

### Parse / normalize

Source fields:

```text
rate_limit.primary_window
rate_limit.secondary_window

window.used_percent
window.limit_window_seconds
window.reset_at
```

Normalization:

```text
used_percent
  → clamp 0..100
  → usedPercent
  → remainingPercent = 100 - usedPercent

limit_window_seconds = 18,000
  → 5hour

limit_window_seconds = 604,800
  → 1week

other duration
  → rejected (fails closed)

reset_at
  → Unix seconds → Date
```

A response with no valid quota windows is an error.

### `codex-app-server` Acquisition Path

If `codex-direct-api` fails, the Codex Provider plan tries the installed Codex CLI as its next verified Acquisition Path on Linux/WSL, native Windows, and macOS. The extension does not require the CLI when the direct path succeeds.

```text
codex app-server --listen stdio://
  → initialize
  → initialized
  → account/rateLimits/read
```

The app-server process is started only for the request and is terminated after a rate-limit snapshot is received or after a 15-second timeout. Lean Quota Monitor does not invoke login, logout, configuration writes, or other mutating app-server methods.

Rate-limit source fields:

```text
rateLimitsByLimitId.codex
  or rateLimits when limitId = codex

primary / secondary
  ├─ usedPercent
  ├─ windowDurationMins
  └─ resetsAt
```

Normalization is duration-based rather than position-based:

```text
300 minutes    → 5hour
10,080 minutes → 1week
other duration → rejected (fails closed)
```

`primary` and `secondary` are not assumed to mean 5hour and 1week respectively. A weekly-only snapshot in `primary` is valid.

---

## Anthropic Claude

Implementation: `src/providers/anthropic.ts`

### Credential authority

```text
$CLAUDE_CONFIG_DIR/.credentials.json
        or
~/.claude/.credentials.json

└─ claudeAiOauth.accessToken
```

The extension reuses the OAuth credential produced by Claude Code login. No browser cookie/session scraping or local statusLine/cache bridge is used. Linux uses `~/.claude/.credentials.json`; native Windows uses `%USERPROFILE%\.claude\.credentials.json`; `CLAUDE_CONFIG_DIR` overrides the containing directory on those file-backed platforms. macOS Claude quota acquisition is intentionally not enabled because Claude Code stores OAuth credentials in macOS Keychain, and Lean Quota Monitor does not directly extract that credential.

### Quota request

```text
GET https://api.anthropic.com/api/oauth/usage
Authorization: Bearer <claudeAiOauth.accessToken>
anthropic-beta: oauth-2025-04-20
```

HTTP timeout: 15 seconds.

### Parse / normalize

Source fields:

```text
five_hour.utilization
five_hour.resets_at

seven_day.utilization
seven_day.resets_at
```

Normalization:

```text
five_hour → 5hour
seven_day → 1week

utilization
  → valid range 0..100
  → usedPercent
  → remainingPercent = 100 - usedPercent

resets_at
  → Date
```

A response with no valid `five_hour` or `seven_day` window is an error.

The OAuth usage route is treated as a verified live Acquisition Path, not as a guaranteed public-stability API contract. HTTP/auth failure exhausts the current Claude path; last-known-good/stale state is a separate concern.

---

## Google Gemini / Antigravity

Implementation: `src/providers/gemini.ts`

### Credential authority

The extension does not own a Gemini credential. Authentication and subscription status remain inside the installed **AGY CLI**. The official AGY CLI supports macOS/Linux and native Windows and uses the system keyring / Google Sign-In flow, so Lean Quota Monitor only requires the `agy` executable to be findable by the active Extension Host.

Required executable:

```text
agy
```

### Quota request

The extension executes AGY directly with `execFile`, not through a shell:

```bash
agy -p '/quota' --output-format stream-json --print-timeout 30s
```

Process timeout: 45 seconds. Maximum captured stdout: 2 MiB.

### Parse / normalize

AGY emits stream-json / NDJSON. The parser scans JSON lines until it finds:

```text
event = command_result
  → command.data.groups[]
  → name = "Gemini Models"
  → buckets[]
```

Only these buckets are used:

```text
gemini-5h      → 5hour
gemini-weekly  → 1week
```

Normalization:

```text
remaining_fraction × 100
  → clamp 0..100
  → remainingPercent
  → usedPercent = 100 - remainingPercent

reset_time
  → Date
```

No matching quota buckets is an error.

A direct Cloud Code `v1internal` quota route is **not configured as an Acquisition Path**. AGY `/quota` remains the Gemini subscription-quota authority for this extension.

---

## MiniMax Token Plan

Implementation: `src/providers/minimax.ts` and MiniMax credential handling in `src/extension.ts`.

### Credential authority

MiniMax uses a **MiniMax Token Plan API Key** stored in VS Code `SecretStorage`.

### Quota request

```text
GET https://www.minimax.io/v1/token_plan/remains
Authorization: Bearer <Token Plan API Key>
```

HTTP timeout: 15 seconds.

`www.minimax.io` is the selected implementation host. An alternate host is not configured as another Acquisition Path.

### Parse / normalize

Source collection:

```text
model_remains[]
```

Per model:

```text
current_interval_remaining_percent
current_weekly_remaining_percent
end_time
weekly_end_time
```

MiniMax can return quota for multiple models. The extension independently selects the **most consumed model** for each window — in other words, the model with the lowest remaining percentage.

```text
interval models
  → highest used %
  → 5hour representative window

weekly models
  → highest used %
  → 1week representative window
```

Normalization:

```text
remaining %
  → require a finite value in 0..100
  → remainingPercent
  → usedPercent = 100 - remainingPercent

end_time / weekly_end_time
  → Date when valid
```

The 5-hour and weekly windows are independent. A response containing only one valid supported window remains a valid `QuotaSnapshot`; only a response with no valid MiniMax quota window raises `SCHEMA_CHANGED`. A non-zero MiniMax `base_resp.status_code` is an API error.

---

## Kimi Code

Implementation: `src/providers/kimi.ts` and Kimi credential handling in `src/extension.ts`.

### Credential authority

Kimi uses a **Kimi Code API Key** stored in VS Code `SecretStorage`.

Kimi Code CLI OAuth credentials are intentionally not configured as an Acquisition Path. The first-party CLI stores managed OAuth credentials under `$KIMI_CODE_HOME/credentials/`, but third-party reuse of the managed OAuth/device flow is not treated as a stable supported contract here. Browser cookies are also not used.

### Quota request

```text
GET https://api.kimi.com/coding/v1/usages
Authorization: Bearer <Kimi Code API Key>
```

HTTP timeout: 15 seconds.

Kimi's official membership documentation defines a shared weekly Kimi Code quota plus a rolling 5-hour window, shared across CLI, VS Code, API Keys, and third-party tools. The `/coding/v1/usages` route and response shape are based on currently maintained third-party monitors. Kimi does not publish this route as a stable public usage API.

### Parse / normalize

Weekly source:

```text
usage.limit
usage.used
usage.remaining
usage.resetTime
  → 1week
```

5-hour source:

```text
limits[]
  → window.duration == 300
  → window.timeUnit == TIME_UNIT_MINUTE
  → detail.limit / used / remaining / resetTime
  → 5hour
```

The parser selects the 5-hour entry by duration rather than array position. Numeric strings are converted to numbers. `usedPercent` is computed from `used / limit`; when `used` is absent but `remaining` is valid, it is derived from `(limit - remaining) / limit`. Percentages are clamped to `0..100`. Invalid reset timestamps are omitted. A response with no valid weekly or 5-hour window is an error.

Current references:

- https://www.kimi.com/code/docs/en/kimi-code/membership.html
- https://github.com/MoonshotAI/kimi-code/blob/main/docs/en/configuration/data-locations.md
- https://github.com/steipete/CodexBar/blob/main/docs/kimi.md
- https://github.com/MoonshotAI/kimi-code/issues/1795

---

## Z.AI / GLM Coding Plan

Implementation: `src/providers/zai.ts` and Z.AI credential handling in `src/extension.ts`.

### Credential authority

Z.AI uses a **Z.AI Coding Plan API Key** stored in VS Code `SecretStorage`.

The first implementation targets the Global Z.AI host only. BigModel China uses the same monitor path on a different host, but region selection is not yet exposed as product configuration.

### Quota request

```text
GET https://api.z.ai/api/monitor/usage/quota/limit
Authorization: <Z.AI API Key>
Accept-Language: en-US,en
Content-Type: application/json
```

HTTP timeout: 15 seconds.

The header shape follows Z.AI's official `glm-plan-usage` plugin, which sends `ANTHROPIC_AUTH_TOKEN` directly in the `Authorization` header for the monitor endpoint.

### Parse / normalize

The current known V2-compatible response contains `data.limits[]`. Lean Quota Monitor recognizes token windows by **type + duration fields**, never by array position:

```text
TOKENS_LIMIT + unit=3 + number=5
  → 5hour

TOKENS_LIMIT + unit=6 + number=1
  → 1week

percentage
  → usedPercent
  → remainingPercent = 100 - usedPercent

nextResetTime
  → epoch milliseconds → Date
```

`TIME_LIMIT` entries represent monthly MCP/tool usage and are intentionally not mixed into this token-quota `QuotaSnapshot` yet.

GLM Coding Plan V3 launched with a points/token-metered plan model, but a confirmed public V3 quota response fixture is not yet available. Unknown token-limit shapes therefore fail closed with `No supported Z.AI quota windows` instead of being guessed or displayed as zero.

Current references:

- https://docs.z.ai/devpack/overview
- https://docs.z.ai/devpack/extension/usage-query-plugin
- https://github.com/zai-org/zai-coding-plugins/blob/main/plugins/glm-plan-usage/skills/usage-query-skill/scripts/query-usage.mjs
- https://github.com/steipete/CodexBar/blob/main/docs/zai.md
- https://github.com/steipete/CodexBar/issues/2522

---

## OpenRouter Credit

Implementation: `src/providers/openrouter.ts` and OpenRouter credential handling in `src/extension.ts`.

### Credential authority

OpenRouter credit monitoring uses an OpenRouter **Management Key** stored in VS Code `SecretStorage`.

A normal inference API key is not silently substituted. Authentication failures are surfaced as the current Provider error.

### Credit request

```text
GET https://openrouter.ai/api/v1/credits
Authorization: Bearer <Management Key>
```

HTTP timeout: 15 seconds.

### Parse / normalize

Source fields:

```text
data.total_credits
data.total_usage
```

Normalization:

```text
total_credits → totalCredits
total_usage   → usedCredits
remainingCredits = totalCredits - usedCredits
currency = USD
```

The resulting `CreditSnapshot` retains total and used values as source facts, but **Remaining Credit** is the primary product-facing metric used by Status Bar, Quick Pick, and Hover. Credit is not converted into a percentage or reset window.

Official references:

- https://openrouter.ai/docs/api/api-reference/credits/get-credits
- https://openrouter.ai/docs/guides/overview/auth/management-api-keys

---

## OpenCode Go

Implementation: `src/providers/opencode.ts`.

### Credential authority

OpenCode Go quota monitoring uses an **OpenCode Go API Key** stored in VS Code `SecretStorage`. The key is issued by the OpenCode console at `https://opencode.ai/zen` after subscribing to Go. A Zen pay-as-you-go key without a Go subscription is a valid key but returns a subscription-required error.

### Quota request

```text
GET https://opencode.ai/zen/go/v1/usage
Authorization: Bearer <OpenCode Go API Key>
User-Agent: lean-quota-monitor
```

HTTP timeout: 15 seconds.

Failure classification: HTTP 401 raises `KEY_INVALID`; HTTP 403 raises `PLAN_REQUIRED`; other HTTP failures stay unclassified.

### Parse / normalize

Source fields:

```text
usage.rolling.percent / resetsAt
usage.weekly.percent / resetsAt
usage.monthly.percent / resetsAt
```

`percent` is the used percent of the dollar-value limit ($12 rolling 5h, $30 weekly, $60 monthly).

Normalization:

```text
rolling  → 5hour
weekly   → 1week
monthly  → 1month

percent
  → clamp 0..100
  → usedPercent
  → remainingPercent = 100 - usedPercent

resetsAt (ISO 8601 string) → Date
```

Each window is normalized independently; the valid subset is retained. `status: "rate-limited"` still yields a valid window (`usedPercent` 100 from the source value). A response with no valid window raises `SCHEMA_CHANGED`.

The usage endpoint is not part of the official public OpenCode API documentation; it is the same endpoint the OpenCode console serves. Shape changes are treated as `SCHEMA_CHANGED`.

Official reference:

- https://opencode.ai/docs/go/

---

Cross-cutting failure classification, lookup targets, recovery behavior, and redacted diagnostics are defined in [`troubleshooting.md`](troubleshooting.md). Durable acquisition and credential trade-offs are recorded in [`adr/0002-provider-acquisition-boundary.md`](adr/0002-provider-acquisition-boundary.md).
