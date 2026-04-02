/**
 * Theme token type definitions — for IDE autocomplete and documentation.
 *
 * These types describe the shape of the CSS custom properties in index.css.
 * They are NOT used at runtime. The source of truth is CSS variables.
 *
 * To customize the theme:
 *   1. Open theme-config.html (the playground)
 *   2. Tweak tokens visually
 *   3. Copy the CSS output
 *   4. Replace the :root block in src/index.css
 */

export interface ThemeTokens {
  palette: {
    primary: string;
    primaryFg: string;
    secondary: string;
    secondaryFg: string;
    success: string;
    successFg: string;
    danger: string;
    dangerFg: string;
    warning: string;
    warningFg: string;
    info: string;
    infoFg: string;
  };
  neutral: {
    bg: string;
    fg: string;
    bgSubtle: string;
    fgSubtle: string;
    bgMuted: string;
    bgEmphasis: string;
    bgBold: string;
    bgStrongest: string;
    bgDim: string;
    border: string;
    borderSubtle: string;
    ring: string;
    ringGlow: string;
  };
  surface: {
    base: string;
  };
  typography: {
    display: { size: string; weight: number; leading: number };
    heading: { size: string; weight: number; leading: number };
    body: { size: string; weight: number; leading: number };
    sm: { size: string; weight: number; leading: number };
    caption: { size: string; weight: number; leading: number };
    code: { size: string; family: string };
  };
  spacing: Record<string, string>;
  shadow: {
    xs: string;
    sm: string;
    md: string;
    lg: string;
  };
  shape: {
    radius: string;
    surfaceRadius: string;
    surfaceInset: string;
    innerRadius: string;
    innerGap: string;
  };
  zIndex: {
    base: number;
    dropdown: number;
    sticky: number;
    modal: number;
    popover: number;
    toast: number;
  };
}

/** CSS custom property names for each token (maps to --{key} in CSS). */
export const TOKEN_CSS_VARS = {
  // Palette
  "palette-primary": "--palette-primary",
  "palette-primary-fg": "--palette-primary-fg",
  "palette-secondary": "--palette-secondary",
  "palette-secondary-fg": "--palette-secondary-fg",
  "palette-success": "--palette-success",
  "palette-success-fg": "--palette-success-fg",
  "palette-danger": "--palette-danger",
  "palette-danger-fg": "--palette-danger-fg",
  "palette-warning": "--palette-warning",
  "palette-warning-fg": "--palette-warning-fg",
  "palette-info": "--palette-info",
  "palette-info-fg": "--palette-info-fg",

  // Neutrals
  "neutral-bg": "--neutral-bg",
  "neutral-fg": "--neutral-fg",
  "neutral-bg-subtle": "--neutral-bg-subtle",
  "neutral-fg-subtle": "--neutral-fg-subtle",
  "neutral-bg-muted": "--neutral-bg-muted",
  "neutral-bg-emphasis": "--neutral-bg-emphasis",
  "neutral-bg-bold": "--neutral-bg-bold",
  "neutral-bg-strongest": "--neutral-bg-strongest",
  "neutral-bg-dim": "--neutral-bg-dim",
  "neutral-border": "--neutral-border",
  "neutral-border-subtle": "--neutral-border-subtle",
  "neutral-ring": "--neutral-ring",
  "neutral-ring-glow": "--neutral-ring-glow",

  // Surfaces
  "surface-base": "--surface-base",

  // Shadows
  "shadow-xs": "--shadow-xs",
  "shadow-sm": "--shadow-sm",
  "shadow-md": "--shadow-md",
  "shadow-lg": "--shadow-lg",

  // Shape
  radius: "--radius",
  "surface-radius": "--surface-radius",
  "surface-inset": "--surface-inset",
  "inner-radius": "--inner-radius",
  "inner-gap": "--inner-gap",
} as const;
