#!/bin/bash
# Symlink @wystack packages from the submodule into node_modules.
# This allows local workspace consumers to resolve them even when tsconfig paths
# do not apply across submodule boundaries (e.g., for imports originating from
# within submodules with their own tsconfig).
#
# Run after `bun install` or `git submodule update`.

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"

mkdir -p "$ROOT/node_modules/@wystack"

for pkg in "$ROOT"/lib/wystack/packages/*/; do
  name=$(basename "$pkg")
  target="$ROOT/node_modules/@wystack/$name"
  if [ -L "$target" ]; then
    rm "$target"
  fi
  ln -s "../../../lib/wystack/packages/$name" "$target"
done

echo "Linked @wystack packages into node_modules"
