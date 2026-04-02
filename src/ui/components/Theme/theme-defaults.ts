import type { PaletteColor } from "@/ui/stores/useThemeStore";

export const DEFAULT_PALETTE_LIGHT: Record<PaletteColor, string> = {
  primary: "oklch(0.205 0 0)",
  secondary: "oklch(0.45 0 0)",
  success: "oklch(0.59 0.19 149)",
  danger: "oklch(0.577 0.245 27.325)",
  warning: "oklch(0.75 0.08 55)",
  info: "oklch(0.55 0.15 250)",
};

export const DEFAULT_PALETTE_DARK: Record<PaletteColor, string> = {
  primary: "oklch(0.922 0 0)",
  secondary: "oklch(0.65 0 0)",
  success: "oklch(0.65 0.19 149)",
  danger: "oklch(0.704 0.191 22.216)",
  warning: "oklch(0.75 0.1 70)",
  info: "oklch(0.65 0.15 250)",
};

export const DEFAULT_SURFACE_LIGHT = "oklch(0.95 0.006 70)";
export const DEFAULT_SURFACE_DARK = "oklch(0.2 0.005 250)";

export const PREVIEW_LEVELS_LIGHT = [1.0, 0.98, 0.96, 0.94, 0.92, 0.9, 0.87];
export const PREVIEW_LEVELS_DARK = [0.12, 0.145, 0.17, 0.19, 0.22, 0.24, 0.26];
