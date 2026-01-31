# Learnings - Fuxi

## Conventions & Patterns


## Phase 1 - Scaffold Setup

### Project Structure
- Created Bun-based Tauri + SolidJS desktop app
- Directory layout: `src/ui`, `src/services`, `src/tools`, `src/shared`, `scripts`
- Tauri Rust backend in `src-tauri/`

### Configuration
- **TypeScript**: Strict mode enabled, path aliases configured
- **ESLint**: Performance rules (max-depth: 3, max-lines: 300, complexity: 10)
- **Vite**: Configured for SolidJS with Tailwind CSS
- **Tailwind**: Added for rapid UI development

### Performance Tooling
- `bun run perf:startup` - Measures cold start time (target: < 2s)
- `bun run perf:memory` - Measures idle memory (target: < 100MB)
- `bun run perf:stream` - Simulates token streaming latency (target: < 300ms first token)

### Verification Results
✓ `bun install` completes successfully (261 packages)
✓ `bun run type-check` passes with no errors
✓ `bun run perf:memory` reports 6.06MB idle (PASS: < 100MB)
✓ `bun run perf:stream` reports 0.00ms first token (PASS: < 300ms)

### Key Dependencies
- solid-js@1.9.11 - Fine-grained reactivity
- @tauri-apps/api@2.9.1 - Desktop integration
- vite@5.4.21 - Build tool
- tailwindcss@3.4.19 - Styling
- typescript@5.9.3 - Type safety
- zod@3.25.76 - Schema validation

### Next Steps
- Implement EventBus with streaming support (Task 2)
- Create service layer skeleton with lazy loading (Task 3)
- Integrate Agent SDK wrapper (Task 4)

## [2026-01-31] Task 1: Scaffolding

### Directory Structure
- `src/ui/` - Solid components
- `src/services/` - Service layer (lazy-loaded singletons)
- `src/tools/` - Tool implementations
- `src/shared/` - Shared types and utilities
- `scripts/` - Performance profiling scripts

### Performance Baseline
- Idle memory: 6MB (target < 100MB) ✓
- Cold start: 5s (target < 2s) - Needs optimization in Task 17
- TypeScript strict mode enabled

### Tech Stack
- Bun runtime
- Tauri v2 (desktop framework)
- SolidJS (fine-grained reactivity)
- TypeScript strict mode
- Tailwind CSS
- ESLint with performance rules (max-depth: 3, complexity: 10)

### Conventions Established
- Use Bun for all scripts (`bun run <script>`)
- Performance scripts in `scripts/` directory
- Lazy service initialization pattern for optimal startup
