# ADR 0006: Low quota warning and single-slot window preemption

- Status: Accepted
- Date: 2026-09-13

## Decision

The Status Bar presents exactly one window per quota provider to keep the display compact.

```text
Status Bar Slot
├─ normal (all windows > threshold) → Primary Window (default: longest duration)
└─ urgent (any window <= threshold)  → preempting urgent window with ⚠️ prefix
```

When multiple windows exist (e.g. 5h and 1w):

1. **Primary Window**: Under normal conditions, the Status Bar renders the configured Primary Window (defaults to longest duration: 1month > 1week > 1day > 5hour, overridable per provider).
2. **Urgent Preemption**: When any duration window drops to or below the Low Quota Warning Threshold (default `20%`), it temporarily preempts the Primary Window and prepends a `⚠️` marker.
3. **Tie-breaking**: Ties among multiple urgent windows favor lower remaining percentage first, then shorter window durations (immediate exhaustion risk).
4. **Opt-out**: Setting the warning threshold to `'off'` pins the Primary Window unconditionally.

Complete multi-window breakdowns remain accessible in Hover details.

## Why

Showing multiple duration windows on the Status Bar clutters the editor and violates the lean Status Bar budget.

Showing only a static long-term window blinds users to imminent short-term rate limits (e.g. a 5-hour cutoff while the weekly quota appears healthy).

Dynamic preemption with a warning threshold balances compactness and timely exhaustion awareness without adding multiple Status Bar items.
