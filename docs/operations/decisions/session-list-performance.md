# Session List Performance Contract

## Decision

`session.list` returns lightweight session summaries, not full session history.

Returned fields are:
- session identity and metadata (`id`, `title`, `createdAt`, `updatedAt`, `parentId`, `metadata`)
- `messageCount`
- `lastMessagePreview`

## Why

List surfaces (Sessions panel, Home recent sessions, Board) are latency-sensitive and frequently refreshed. Returning full `messages[]` for every session causes avoidable serialization, transport, and client render cost.

## Implications

- Session list UI search is intentionally scoped to summary fields (`title`, goal metadata, and `lastMessagePreview`).
- Deep history search should be handled by dedicated server-side search (`session.search`) or a future indexed endpoint.
- Full session history remains available via `session.get` / `session.messages` when a specific session is opened.

## Status

Adopted in this branch (February 15, 2026).
