#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VERSION="$(node -p "require('./package.json').version")"
ARTIFACT_DIR="$ROOT/out/vsix"
VSIX="$ARTIFACT_DIR/lean-quota-monitor-$VERSION.vsix"

rm -rf "$ROOT/out"
mkdir -p "$ARTIFACT_DIR"
pnpm run compile
pnpm exec vsce package --out "$VSIX" --no-dependencies
printf '%s\n' "$VSIX"
