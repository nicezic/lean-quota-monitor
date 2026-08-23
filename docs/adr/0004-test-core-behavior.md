# ADR 0004: Test core behavior instead of implementation details

- Status: Accepted
- Date: 2026-08-19

## Decision

Test what the product really does, not how the code is written inside.

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
```

Rules:

- One test set per boundary above. A higher-level test also covers the helpers inside it. Do not write one test per helper.
- Provider responses: use one real successful response per acquisition path. The test proves that this real response becomes the expected snapshot.
- Do not invent broken responses (null, missing fields, wrong types, out-of-range numbers) to test the parser's defenses.
- Exception: when the provider contract itself defines a distinct behavior for a broken response (example: `SCHEMA_CHANGED`), keep one test for that behavior.
- Coverage numbers are not a target.

## Why

Protect actual product behavior instead of implementation details.

This reduces test code, duplication, and complexity while keeping the important regression protection. Internal refactoring should require fewer test changes when the behavior stays the same.
