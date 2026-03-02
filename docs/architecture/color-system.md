# Color System

Last updated: 2026-03-02

Source of truth: `src/index.css` (CSS custom properties in `:root` and `.dark`).

## Overview

Three token categories with strict separation of concerns:

```
PALETTE   — semantic accent colors (status + interactive)
NEUTRAL   — configurable gray family (text, backgrounds, borders, glass surfaces)
SURFACE   — app shell ground (1 token)
```

**Palette** carries meaning (primary, danger, success). **Neutral** provides structure (all grays, borders, rings, and glass layers). **Surface** is the tinted ground everything sits on.

Total: 35 CSS custom properties (12 palette + 15 neutral + 1 surface + 7 utility).

## Palette (12 tokens)

Six semantic colors, each with a base and foreground pair: `--palette-{name}` + `--palette-{name}-fg`.

| Token | Light | Dark | Purpose |
|-------|-------|------|---------|
| `primary` / `primary-fg` | oklch(0.205 0 0) / oklch(0.985 0 0) | oklch(0.922 0 0) / oklch(0.205 0 0) | Default interactive, buttons, links |
| `secondary` / `secondary-fg` | oklch(0.45 0 0) / oklch(0.985 0 0) | oklch(0.65 0 0) / oklch(0.145 0 0) | Secondary actions, subtle emphasis |
| `success` / `success-fg` | oklch(0.59 0.19 149) / oklch(0.985 0 0) | oklch(0.65 0.19 149) / oklch(0.145 0 0) | Positive state, completion |
| `danger` / `danger-fg` | oklch(0.577 0.245 27.325) / oklch(0.985 0 0) | oklch(0.704 0.191 22.216) / oklch(0.985 0 0) | Errors, destructive actions |
| `warning` / `warning-fg` | oklch(0.75 0.08 55) / oklch(0.205 0 0) | oklch(0.75 0.1 70) / oklch(0.205 0 0) | Caution, attention |
| `info` / `info-fg` | oklch(0.55 0.15 250) / oklch(0.985 0 0) | oklch(0.65 0.15 250) / oklch(0.145 0 0) | Informational, help |

**Design choice:** Primary and secondary are achromatic (black/gray) by default. Users can swap in hue-bearing brand colors. Shades are derived via Tailwind opacity modifiers (e.g. `bg-palette-primary/10` for soft tints).

## Neutral (13 tokens)

One namespace, one optional hue tint. Swapping the neutral family (like shadcn's slate/zinc/stone) shifts text, backgrounds, borders, and rings coherently.

### Background scale (M3-inspired, 7 tonal levels)

Based on Material Design 3's surface container system. Light mode goes from white down; dark mode goes from near-black up.

| Token | Light | Dark | M3 Equivalent | Use Case |
|-------|-------|------|---------------|----------|
| `neutral-bg` | oklch(1.0 0 0) | oklch(0.145 0 0) | Container Lowest | Card bg, opaque containers |
| `neutral-bg-subtle` | oklch(0.98 0 0) | oklch(0.17 0 0) | Surface | Hover states, focus fills |
| `neutral-bg-muted` | oklch(0.96 0 0) | oklch(0.19 0 0) | Container Low | Code blocks, table headers |
| `neutral-bg-emphasis` | oklch(0.94 0 0) | oklch(0.22 0 0) | Container | Input fills, active states |
| `neutral-bg-bold` | oklch(0.92 0 0) | oklch(0.24 0 0) | Container High | Strong container fills |
| `neutral-bg-strongest` | oklch(0.90 0 0) | oklch(0.26 0 0) | Container Highest | Maximum emphasis |
| `neutral-bg-dim` | oklch(0.87 0 0) | oklch(0.12 0 0) | Surface Dim | Disabled fills, dimmed areas |

### Text

| Token | Light | Dark | Use Case |
|-------|-------|------|----------|
| `neutral-fg` | oklch(0.145 0 0) | oklch(0.985 0 0) | Primary text |
| `neutral-fg-subtle` | oklch(0.556 0 0) | oklch(0.708 0 0) | Secondary text, labels, placeholders |

### Borders and rings

| Token | Light | Dark | Use Case |
|-------|-------|------|----------|
| `neutral-border` | oklch(0.922 0 0) | oklch(1 0 0 / 10%) | Default borders |
| `neutral-border-subtle` | oklch(0.95 0 0) | oklch(1 0 0 / 6%) | Lighter borders |
| `neutral-ring` | oklch(0.708 0 0) | oklch(0.556 0 0) | Focus rings |
| `neutral-ring-glow` | oklch(0.708 0 0 / 30%) | oklch(0.556 0 0 / 20%) | Focus glow, resting glow |

## Surface (1 token)

Only `surface-base` — the app's customizable tinted ground (shell background).

| Token | Light | Dark |
|-------|-------|------|
| `surface-base` | oklch(0.95 0.006 70) | oklch(0.2 0.005 250) |

Light uses a warm yellowish tint; dark uses a cool bluish tint. The shell background is a gradient derived from `surface-base` values (see `--shell-bg` in index.css).

## Glass Layering Model

All visual surfaces derive from `neutral-bg` at varying opacities over `surface-base`. Lower opacity = more tint bleed-through from the ground. This creates depth without extra tokens.

```
Opacity ladder (low → high transparency):

bg-neutral-bg          → cards, opaque containers (pure neutral-bg, no tint)
bg-neutral-bg/95       → stage / reading surface (faintest tint)
bg-neutral-bg/90       → side panels (subtle tint)
bg-neutral-bg/80       → chat input (prominent glass, elevated with glow)
bg-neutral-bg/65       → floating glass (popovers, overlays)
bg-neutral-bg/45       → main content panel (strongest tint, heaviest blur)
bg-surface-base        → shell ground (fully tinted)
```

### Glass properties by component

| Component | Opacity | Blur | Saturate | Shadow | File |
|-----------|---------|------|----------|--------|------|
| Main panel | /45 | 40px | 1.6 | — | `surface.tsx` variant="main" |
| Chat input | /80 | 24px | 1.4 | shadow-lg + resting glow | `MessageInput.tsx` |
| Side panels | /90 | 24px | 1.4 | shadow-md | `surface.tsx` variant="panel" |
| Stage | /95 | — | — | — | `surface.tsx` variant="stage" |
| Cards | opaque | — | — | shadow-sm or border | `card.tsx` |

**Chat input elevation:** Uses `shadow-lg` + `ring-glow` at rest to float above the `/95` stage. On focus, the glow intensifies and a solid `ring` appears.

## Tailwind Bridge

CSS custom properties are mapped to Tailwind utility classes via `@theme inline` in index.css:

```css
@theme inline {
  --color-palette-primary: var(--palette-primary);
  --color-neutral-bg: var(--neutral-bg);
  --color-surface-base: var(--surface-base);
  /* ... etc */
}
```

This enables classes like `bg-palette-primary`, `text-neutral-fg`, `bg-neutral-bg/80`.

## Theming

The architecture supports user theming by swapping two groups:

1. **Palette** — swap accent colors (e.g. indigo primary instead of achromatic black)
2. **Neutral** — swap gray family (e.g. slate, zinc, stone — shifts all text, backgrounds, borders coherently)

`surface-base` is app-structural (the shell tint) and doesn't typically change per-theme.

## Utilities

Kept as standalone tokens, not part of the three main categories:

```css
--scrollbar        /* scrollbar thumb color */
--code-bg          /* code block background (legacy, may migrate to neutral-bg-muted) */
--chart-1..5       /* chart color palette */
```
