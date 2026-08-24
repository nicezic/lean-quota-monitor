# ADR 0003: Use latest stable development dependencies

- Status: Accepted
- Date: 2026-08-19

## Decision

Install development dependencies without version suffixes so pnpm selects the latest stable versions.

Refresh all direct development dependencies together. Do not intentionally leave one behind except `@types/node`.

The Node.js type package is installed with the only pinned version:

```bash
pnpm add --save-dev @types/node@24
```

Keep `engines.node` and `@types/node` on Node.js 24 until the project deliberately changes its LTS runtime. `package.json` therefore keeps:

```json
"@types/node": "^24"
```
