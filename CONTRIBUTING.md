# Contributing

Lean Quota Monitor is intentionally small. Contributions should preserve its direct Provider-specific acquisition, normalized snapshot boundary, native VS Code UI, and explicit troubleshooting/security contracts.

For an autonomous AI contribution, use [`docs/contribution-prompt.md`](docs/contribution-prompt.md). This file is the human contributor guide.

## Read the contract you are changing

Start with the smallest relevant set:

- [`CONTEXT.md`](CONTEXT.md) — domain vocabulary.
- [`docs/architecture.md`](docs/architecture.md) — current runtime structure and ownership boundaries.
- [`docs/provider-acquisition-spec.md`](docs/provider-acquisition-spec.md) — exact Built-in acquisition and normalization contracts.
- [`docs/troubleshooting.md`](docs/troubleshooting.md) — failure, lookup-target, and recovery contract.
- [`docs/adr/`](docs/adr/) — durable reasons behind surprising or hard-to-reverse decisions.

Do not copy a changed policy into several documents. Update the authority that owns the fact.

## Improve the contribution process

Suggest improvements to `docs/contribution-prompt.md` or the contribution process. The maintainer will actively review them.

## Setup and local validation

Use the versions and commands declared by the repository (`package.json`, lockfile, VS Code configuration) as the executable source of truth.

```bash
pnpm install
pnpm run check
git diff --check
```

`pnpm run check` is the normal full local gate for lint, unit tests, source compilation, and test type-checking.

## Build

```bash
pnpm run package:vsix
```

For changes where the installed VSIX shape matters, use the repository's current packaged-acceptance script/task rather than inventing another reload/install path.

## Change rules

### Built-in Providers

Keep raw Provider acquisition/parsing behind the Provider-owned acquisition boundary. Presentation code should consume normalized `ProviderSnapshot` values rather than Provider-specific response shapes.

When acquisition behavior changes, update the affected implementation, focused regression tests, and `docs/provider-acquisition-spec.md` together. Troubleshooting behavior belongs in `docs/troubleshooting.md`.

### Custom Providers

Custom Provider stdout remains an opaque status value unless a deliberate product change says otherwise. The extension must not infer quota, credit, currency, or another domain meaning from it.

### Security

- Never commit, log, or render raw credentials/tokens/cookies.
- Reuse existing local login authorities where the Provider contract says so.
- Extension-owned API keys belong in VS Code `SecretStorage`.
- Preserve Custom Provider credential ownership in the script.

### Scope discipline

Prefer the smallest self-contained change. Avoid speculative fallback/recovery trees, generic frameworks, or unrelated cleanup unless the contribution actually requires them.

## Before submitting

1. Run focused tests while editing, then the full applicable repository gate.
2. Run any relevant live/package acceptance when runtime UI, Extension Host behavior, Provider acquisition, SecretStorage, packaging, or reload behavior changed.
3. Review the final diff against both the requested behavior and the repository contracts.
4. Keep unrelated local changes out of the contribution.
5. Update only the documentation authority that owns a changed durable fact.

Public Marketplace publishing/release deployment is currently outside this contribution guide.

## Autonomous AI contributions

Give the agent [`docs/contribution-prompt.md`](docs/contribution-prompt.md) plus a feature/fix request and let it carry the contribution through investigation, implementation, validation, review, and PR creation when repository permissions/tooling allow.
