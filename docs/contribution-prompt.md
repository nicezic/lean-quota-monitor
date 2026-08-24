# Autonomous AI Contribution Prompt

This document is the public execution contract for an AI contributor working on Lean Quota Monitor.

A user should be able to give an AI agent this file plus a change request and expect the agent to carry the work through investigation, implementation, validation, review, and PR creation when the repository environment permits it.

Example invocation:

```text
Read docs/contribution-prompt.md and implement this request:

<feature / fix / improvement request>
```

## Mission

Own the requested change end to end. Do not stop after proposing code or describing what should be done.

```text
request
→ inspect
→ research when needed
→ design
→ implement
→ focused tests
→ full validation
→ review the diff against request + repo contracts
→ update owned docs
→ commit
→ push
→ open PR
```

Public Marketplace publishing and release deployment are outside this contract.

## 1. Establish the work boundary

Before editing:

1. Inspect the live repository state (`git status`, current branch, recent commits, package scripts, affected source/tests).
2. Preserve unrelated user work. Do not discard, rewrite, or silently include unrelated changes.
3. Treat the user's request as the feature/fix spec. Extract concrete observable acceptance criteria from it.
4. Read only the authorities needed for the affected branch:
   - `CONTEXT.md` — domain vocabulary.
   - `docs/architecture.md` — current runtime structure and ownership boundaries.
   - `docs/provider-acquisition-spec.md` — exact Built-in acquisition/normalization contract when Provider acquisition changes.
   - `docs/troubleshooting.md` — failure/lookup/recovery contract when diagnostics or setup changes.
   - relevant ADRs under `docs/adr/` — core decisions and Why.
   - source and tests directly affected by the request.

Those files own product facts. This prompt owns the contribution process; do not copy product policy into this file.

**Done when:** the requested behavior, affected boundaries, existing worktree constraints, and relevant authority files are identified from live evidence.

## 2. Research facts; do not ask the user to fetch them

When the design depends on current external behavior—VS Code, Node, a Provider API/CLI, authentication, schema, maintained libraries, or another project—verify current primary sources before implementing.

Prefer official documentation, source code, specifications, and maintained upstream repositories. Distinguish verified facts from inference. Do not create speculative fallback/recovery paths just because they might help.

Ask the user only for genuine product decisions or unavailable credentials/permissions, not facts the environment or primary sources can answer.

**Done when:** every external assumption that significantly affects the implementation is either verified or explicitly marked unresolved.

## 3. Design the smallest self-contained change

Prefer direct, observable behavior over generic frameworks or speculative abstraction.

Before implementation, check that the proposed change fits the existing module boundaries rather than duplicating logic across UI, Provider, and diagnostic layers.

For Built-in Provider work, preserve the existing normalized snapshot boundary and keep acquisition behavior with the Provider rather than leaking raw Provider shapes into presentation code.

For Custom Providers, preserve their intentionally opaque output contract unless the request explicitly changes it.

If the request exposes a hard-to-reverse and surprising trade-off with real alternatives, update or add an ADR. Ordinary implementation details, naming cleanup, and reversible choices do not need ADRs.

**Done when:** there is one clear implementation path with no unnecessary new layer or silent fallback.

## 4. Implement with a tight feedback loop

1. Make the smallest self-contained change that satisfies the acceptance criteria. Do not introduce unrelated runtime changes just to make the contribution look larger.
2. Add or update focused regression tests when observable runtime behavior changes. Match validation to the kind of change being made.
3. Run the narrowest useful test/typecheck/lint/document loop while editing.
4. Keep credentials and raw sensitive Provider data out of logs, rendered UI, fixtures, commits, and PR text.
5. Update the document that owns any changed durable fact; point to other authorities rather than duplicating the rule.

Do not claim behavior that has not been exercised or supported by evidence.

**Done when:** the requested behavior is implemented and focused checks cover its meaningful failure/success boundary.

## 5. Run the repository gate

Before review, run the current repository validation exposed by `package.json` and configuration. At minimum for the current repository:

```bash
pnpm run check
git diff --check
```

If runtime UI, Extension Host behavior, Provider acquisition, SecretStorage, packaging, or reload behavior changed, perform the relevant live/package acceptance supported by the repository as well. Use the repository's current scripts/configuration rather than hard-coding an obsolete command from this document.

If a validation step fails, fix the owned failure and rerun it. Do not report a passing gate that did not actually pass.

**Done when:** the full applicable local gate is green and any required live acceptance is recorded accurately.

## 6. Review against two independent questions

Review the final diff from a fixed point (normally the branch merge-base or the commit before this task) along two axes:

### Spec

- Did the change satisfy every observable requirement in the user's request?
- Is anything requested missing or only partially implemented?
- Did the change introduce behavior that was not requested?

### Standards

- Does the diff respect the repository's documented architecture, security, Provider, troubleshooting, test, and documentation contracts?
- Is the same rule or logic duplicated across files when one authority/module should own it?
- Did the change introduce unnecessary generality, speculative fallback paths, or unrelated cleanup?

If independent subagents/reviewers are available, use separate fresh-context reviews for the two axes. Otherwise perform two separate review passes yourself. Fix major findings, rerun affected checks, then review the final diff again.

**Done when:** both Spec and Standards reviews have no unresolved major findings.

## 7. Prepare a clean contribution

1. Re-check `git status` and the final diff.
2. Stage only files owned by this contribution; preserve unrelated work.
3. Use a concise logical commit message that describes the behavior change.
4. Commit only after the applicable validation and review are green.

If the current branch is not appropriate for a PR, create/use a focused contribution branch without rewriting unrelated history.

**Done when:** the contribution is represented by clean logical commit(s) with no accidental unrelated changes.

## 8. Push and open the PR

When Git remote access and an authenticated PR tool are available:

1. Push the contribution branch.
2. Open a pull request against the repository's normal target branch.
3. PR title: concise behavior outcome.
4. PR body should include:
   - what changed and why
   - user-visible behavior / acceptance criteria
   - validation actually run
   - live acceptance, if any
   - intentionally deferred work or known limits

Do not include credentials, private local paths/content, raw Provider payloads, or unsupported claims.

If push/PR creation is impossible because authentication, remote permissions, or PR tooling are unavailable, do not pretend it succeeded. Leave the repository PR-ready and report the exact blocker plus the branch/commit that is ready to push.

**Done when:** the PR exists, or a verified external permission/tooling blocker is the only remaining step.

## Completion contract

A contribution is not complete just because code was written.

Complete means:

```text
requested behavior implemented
+ relevant tests added/updated
+ applicable local gate green
+ Spec review green
+ Standards review green
+ durable docs synchronized at their owner
+ clean commit(s)
+ PR opened when permissions/tooling allow
```

Final report to the user should be concise and factual: behavior changed, important files, validation, review result, commit/PR, and any real blocker or deferred item.

If you find a contribution-process improvement, suggest it to the maintainer.
