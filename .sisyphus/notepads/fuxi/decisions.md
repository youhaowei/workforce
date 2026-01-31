# Architectural Decisions - Fuxi

## Core Decisions

- **Architecture**: In-process services + EventBus (no HTTP server)
- **Performance**: First-class concern - all implementations optimized for memory and CPU
- **Framework**: Tauri + SolidJS (Bun runtime)
- **Auth**: Local Claude Code auth (dev-only)

