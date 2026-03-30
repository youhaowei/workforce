# Diff Component Library Spike

**Date**: 2026-03-29
**Status**: Decision made

## Context

Workforce needs a diff viewer for displaying file changes in sessions. Requirements:
1. Split/unified diff toggle
2. Inline comment anchoring on specific lines/ranges
3. Virtualization for 1000+ line diffs
4. Syntax highlighting
5. Theming (OKLCH CSS variable system)
6. Reasonable bundle size
7. Active maintenance

## Candidates Evaluated

### 1. @pierre/diffs (v1.1.7)

Shiki-based diff rendering library with vanilla JS core and framework bindings (React, Solid). Built by the Pierre team (creators of the T3 Code editor).

**What it provides:**
- `FileDiff` React component renders a single file diff with syntax highlighting
- `Virtualizer` component for rendering multiple file diffs efficiently
- `parsePatchFiles()` parses unified diff strings into structured metadata
- `parseDiffFromFile()` computes diffs from before/after content strings
- `WorkerPoolManager` offloads highlighting to web workers (configurable pool size)
- Built-in split/unified toggle (`diffStyle: "split" | "unified"`)
- Line annotations API for injecting arbitrary content (comments, CI results, accept/reject buttons)
- Line selection API (`enableLineSelection`, `setSelectedLines`, `onLineSelectionEnd`)
- Custom element (`<diffs-container>`) with Shadow DOM isolation
- `unsafeCSS` prop for injecting CSS into the shadow DOM for theme overrides
- `registerCustomTheme()` for custom Shiki themes
- Word-level and character-level inline diff highlighting
- Font customization (family, size, line-height, features)
- Hunk separators with expand controls

**Who uses it:**
- **T3 Code** (React) -- full-featured diff panel with turn-based navigation, worker pool, custom theme overrides via CSS variables. Uses `Virtualizer` for multiple file diffs.
- **OpenCode** (Solid) -- `FileDiff` class directly, worker pool (pool size 2), extensive custom CSS for selection highlighting, annotation support for code review.
- **Craft Agents** (React) -- `ShikiDiffViewer` and `UnifiedDiffViewer` wrappers, `MultiDiffPreviewOverlay` for stacked multi-file diffs, custom Shiki themes.

**Theming approach observed in references:**
All three projects override pierre's internal CSS variables via `unsafeCSS`. T3 Code uses `color-mix(in srgb, ...)` with their design tokens. OpenCode maps their own `--syntax-diff-*` variables into pierre's `--diffs-*` variables. Craft registers custom Shiki themes with transparent backgrounds so their CSS variables show through.

**Bundle size:** Not published on npm stats. Core is Shiki-based so includes grammar/theme data. Worker pool approach offloads the heaviest work. The `@pierre/diffs/react` entry point is the minimal import for rendering.

### 2. react-diff-viewer (v3.1.1)

Popular React diff component. **Last published 6 years ago (2020).** Unmaintained.

Community forks exist (`react-diff-viewer-continued`, `react-diff-viewer-refined`) but none have significant traction or active development.

**What it provides:**
- Split/unified view toggle
- Line-level highlighting
- Custom styling via CSS/styled-components
- No virtualization
- No syntax highlighting (plain text only)
- No annotation/comment anchoring API
- No worker offloading

**Limitations:**
- Dead project -- no React 19 support, no Shiki integration
- Would require substantial custom work to add syntax highlighting, virtualization, and comment anchoring
- Styled-components dependency conflicts with our Tailwind/CVA approach

### 3. Custom build (diff algorithm + custom rendering)

Build our own diff viewer on top of `diff` (npm) or `jsdiff` for the algorithm, plus Shiki for highlighting.

**What we'd need to build:**
- Diff computation (use `diff` npm package or `@pierre/precision-diffs`)
- Split/unified rendering layout with proper line numbering
- Hunk display with expand/collapse
- Word-level inline diff highlighting
- Syntax highlighting integration (Shiki worker setup)
- Virtualization for large diffs
- Line selection and annotation anchoring
- Theme variable integration
- Shadow DOM isolation (optional but good for style encapsulation)

**Estimated effort:** 3-6 weeks of focused work to reach parity with what @pierre/diffs provides out of the box.

## Comparison Table

| Criteria | @pierre/diffs | react-diff-viewer | Custom Build |
|---|---|---|---|
| Split/unified toggle | Built-in | Built-in | Must build |
| Inline comment anchoring | Annotation API + line selection | No API | Must build |
| Virtualization (1000+ lines) | `Virtualizer` component | None | Must build (react-virtuoso exists) |
| Syntax highlighting | Shiki (200+ languages) | None | Must integrate Shiki |
| OKLCH theming | Via `unsafeCSS` + CSS var overrides | Styled-components only | Full control |
| Bundle size | Medium (Shiki grammars) | Small | Depends on scope |
| Maintenance | Active (v1.1.7, published daily) | Dead (6 years) | On us |
| Custom work needed | Theme CSS overrides, wrapper component | Everything except basic layout | Everything |
| Worker offloading | Built-in `WorkerPoolManager` | N/A | Must build |
| React 19 compat | Yes (used by T3 Code on React 19) | No | Yes |
| Shadow DOM isolation | Built-in | No | Optional |

## Recommendation: @pierre/diffs

**Use `@pierre/diffs`** with a thin Workforce wrapper component.

### Reasoning

1. **Proven at scale.** Three major coding tools (T3 Code, OpenCode, Craft Agents) all independently chose this library and ship it in production. This is strong signal.

2. **Covers all requirements.** Split/unified toggle, annotation API for comments, Virtualizer for large diffs, Shiki highlighting, and extensible theming are all built in. No gaps to fill.

3. **Theming is solvable.** All three reference implementations successfully override pierre's CSS variables to match their own design systems. Our OKLCH tokens can be mapped into pierre's `--diffs-*` variables via `unsafeCSS`, following the same `color-mix()` pattern T3 Code uses. The Shadow DOM encapsulation means our overrides won't leak.

4. **Worker pool is valuable.** Syntax highlighting is CPU-intensive. Pierre's `WorkerPoolManager` offloads this to web workers, keeping the UI thread responsive for large diffs. Building this ourselves would be significant effort.

5. **Active maintenance.** v1.1.7 published within the last day, 50+ dependents on npm. The Shiki foundation means language support stays current automatically.

6. **Low integration cost.** We need:
   - A `DiffViewer` wrapper component (similar to Craft's `ShikiDiffViewer`)
   - A theme CSS file mapping our OKLCH tokens to pierre's CSS variables
   - A worker pool provider (copy T3 Code's `DiffWorkerPoolProvider` pattern)
   - Estimated: 2-3 days vs 3-6 weeks for custom build

### Risks and Mitigations

- **Shadow DOM styling friction:** Pierre renders into Shadow DOM, so our Tailwind utilities don't apply directly inside diffs. Mitigation: use `unsafeCSS` for theme overrides (proven pattern from all 3 references).
- **Bundle size from Shiki grammars:** Mitigation: pierre supports lazy loading grammars via workers. Only commonly-needed languages load upfront.
- **API surface coupling:** If pierre changes its API, we need to update. Mitigation: our wrapper component isolates the rest of the app from pierre's API.

### Integration Plan

1. Install `@pierre/diffs` (latest `^1.1`)
2. Create `src/ui/components/DiffViewer/` with:
   - `DiffViewer.tsx` -- wrapper around `FileDiff` with Workforce theming
   - `DiffWorkerPool.tsx` -- worker pool provider (pool size 2-4)
   - `diff-theme.css` -- OKLCH token mapping to pierre CSS variables
3. Use `Virtualizer` for multi-file diff views
4. Use annotation API when implementing inline comments
