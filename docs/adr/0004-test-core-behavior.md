# ADR 0004: Test core behavior instead of implementation details

- Status: Accepted
- Date: 2026-08-19

## Decision

Test the product at its core behavior boundaries:

```text
External Provider Response
          ↓
   Built-in Provider
   parse / normalize
          ↓
    ProviderSnapshot
          ↓
      Acquisition
 ordered paths / first success
          ↓
      ProviderState
       ┌──┴──┐
       ↓     ↓
   Monitor  Refresh / Order

Core feature tests
════════════════════════════════
exercise these boundaries end-to-end
and cover the helpers inside them
```

Higher-level feature tests should cover the lower-level helpers and behavior they depend on. Do not create a direct unit test for every helper.

Coverage numbers are not a target.

## Why

Protect actual product behavior instead of implementation details.

This reduces test code, duplication, and complexity while keeping the important regression protection. Internal refactoring should require fewer test changes when the behavior stays the same.
