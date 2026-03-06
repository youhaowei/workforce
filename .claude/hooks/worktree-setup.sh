#!/usr/bin/env bash
set -euo pipefail

INPUT=$(cat)
NAME=$(echo "$INPUT" | jq -r '.name')
CWD=$(echo "$INPUT" | jq -r '.cwd')

# Create worktree (replaces default behavior)
DIR="$HOME/.agents/worktrees/workforce/$NAME"
git -C "$CWD" worktree add -b "$NAME" "$DIR" HEAD >&2

# Install dependencies
cd "$DIR"
bun install >&2

# Restore local unifai link
bun link ~/Projects/unifai >&2

# Print path (required — Claude Code reads this as the worktree directory)
echo "$DIR"
