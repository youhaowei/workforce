import {create} from "zustand";
import {formatOklch, parseOklch, oklchToHex} from "@/ui/lib/oklch";

export type ThemeMode = "system" | "light" | "dark";
export type ResolvedMode = "light" | "dark";
export type SurfaceTintStyle = "solid" | "gradient2" | "gradient3";

export type PaletteColor = "primary" | "secondary" | "success" | "danger" | "warning" | "info";

/** Per-mode color overrides */
export interface ModeOverrides {
    palette?: Partial<Record<PaletteColor, string>>;
    neutralHue?: number;
    neutralChroma?: number;
    surfaceBase?: string;
    surfaceTintStyle?: SurfaceTintStyle;
}

/** Top-level overrides keyed by mode */
export interface ThemeOverrides {
    light?: ModeOverrides;
    dark?: ModeOverrides;
}

interface ThemeState {
    mode: ThemeMode;
    overrides: ThemeOverrides;
    /** Temporary preview override (used when panel is open in system mode) */
    previewMode: ResolvedMode | null;
    setMode: (mode: ThemeMode) => void;
    setOverrides: (overrides: ThemeOverrides) => void;
    resetOverrides: () => void;
    setPreviewMode: (preview: ResolvedMode | null) => void;
}

const THEME_STORAGE_KEY = "workforce-theme";
const OVERRIDES_STORAGE_KEY = "workforce-theme-overrides";
const RECENT_COLORS_KEY = "workforce-recent-colors";
const MAX_RECENT_COLORS = 12;

// ── Neutral token definitions ────────────────────────────────────────────────

interface NeutralTokenDef {
    light: {l: number; alpha?: number};
    dark: {l: number; alpha?: number};
}

const NEUTRAL_TOKENS: Record<string, NeutralTokenDef> = {
    fg: {light: {l: 0.145}, dark: {l: 0.985}},
    "fg-subtle": {light: {l: 0.556}, dark: {l: 0.708}},
    bg: {light: {l: 1.0}, dark: {l: 0.145}},
    "bg-subtle": {light: {l: 0.98}, dark: {l: 0.17}},
    "bg-muted": {light: {l: 0.96}, dark: {l: 0.19}},
    "bg-emphasis": {light: {l: 0.94}, dark: {l: 0.22}},
    "bg-bold": {light: {l: 0.92}, dark: {l: 0.24}},
    "bg-strongest": {light: {l: 0.9}, dark: {l: 0.26}},
    "bg-dim": {light: {l: 0.87}, dark: {l: 0.12}},
    border: {light: {l: 0.922}, dark: {l: 1, alpha: 0.1}},
    "border-subtle": {light: {l: 0.95}, dark: {l: 1, alpha: 0.06}},
    ring: {light: {l: 0.708}, dark: {l: 0.556}},
};

const NEUTRAL_TOKEN_NAMES = Object.keys(NEUTRAL_TOKENS);

// ── Helpers ──────────────────────────────────────────────────────────────────

function getStoredTheme(): ThemeMode {
    try {
        const stored = localStorage.getItem(THEME_STORAGE_KEY);
        if (stored === "light" || stored === "dark" || stored === "system") return stored;
    } catch {
        /* ignore */
    }
    return "system";
}

function getStoredOverrides(): ThemeOverrides {
    try {
        const stored = localStorage.getItem(OVERRIDES_STORAGE_KEY);
        if (stored) return JSON.parse(stored);
    } catch {
        /* ignore */
    }
    return {};
}

function getSystemPrefersDark() {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/**
 * Resolve which mode is active, factoring in preview override.
 * previewMode takes precedence when set (panel is previewing a specific mode).
 */
export function resolveIsDark(mode: ThemeMode, previewMode?: ResolvedMode | null) {
    if (previewMode != null) return previewMode === "dark";
    return mode === "dark" || (mode === "system" && getSystemPrefersDark());
}

function applyTheme(mode: ThemeMode, previewMode?: ResolvedMode | null) {
    const isDark = resolveIsDark(mode, previewMode);
    document.documentElement.classList.toggle("dark", isDark);

    // Vibrancy mismatch: macOS vibrancy follows system theme, not app theme.
    // When they differ, fall back to solid background so the tint looks correct.
    const systemDark = getSystemPrefersDark();
    const mismatch = isDark !== systemDark;
    if (mismatch) {
        document.documentElement.dataset.vibrancyMismatch = "";
    } else {
        delete document.documentElement.dataset.vibrancyMismatch;
    }
}

function contrastFg(oklchStr: string) {
    try {
        const {l} = parseOklch(oklchStr);
        return l > 0.6 ? "oklch(0.205 0 0)" : "oklch(0.985 0 0)";
    } catch {
        return "oklch(0.985 0 0)";
    }
}

function applyPaletteOverrides(style: CSSStyleDeclaration, palette: ModeOverrides["palette"]) {
    const paletteColors: PaletteColor[] = [
        "primary",
        "secondary",
        "success",
        "danger",
        "warning",
        "info",
    ];
    for (const name of paletteColors) {
        const value = palette?.[name];
        if (value) {
            style.setProperty(`--palette-${name}`, value);
            style.setProperty(`--palette-${name}-fg`, contrastFg(value));
        } else {
            style.removeProperty(`--palette-${name}`);
            style.removeProperty(`--palette-${name}-fg`);
        }
    }
}

function applyNeutralOverrides(
    style: CSSStyleDeclaration,
    modeKey: ResolvedMode,
    isDark: boolean,
    neutralHue: number | undefined,
    neutralChroma: number | undefined,
) {
    if (neutralHue != null || neutralChroma != null) {
        const hue = neutralHue ?? 0;
        const chroma = neutralChroma ?? 0;
        for (const token of NEUTRAL_TOKEN_NAMES) {
            const def = NEUTRAL_TOKENS[token][modeKey];
            style.setProperty(`--neutral-${token}`, formatOklch(def.l, chroma, hue, def.alpha));
        }
        const ringDef = NEUTRAL_TOKENS["ring"][modeKey];
        style.setProperty(
            "--neutral-ring-glow",
            formatOklch(ringDef.l, chroma, hue, isDark ? 0.2 : 0.3),
        );
    } else {
        for (const token of NEUTRAL_TOKEN_NAMES) {
            style.removeProperty(`--neutral-${token}`);
        }
        style.removeProperty("--neutral-ring-glow");
    }
}

function buildShellBg(
    tintStyle: SurfaceTintStyle,
    start: string, mid: string, end: string,
): string {
    const dir = "to bottom right";
    if (tintStyle === "gradient3") return `linear-gradient(${dir}, ${start} 0%, ${mid} 50%, ${end} 100%)`;
    if (tintStyle === "gradient2") return `linear-gradient(${dir}, ${mid} 0%, ${end} 100%)`;
    return mid;
}

function applySurfaceOverrides(
    style: CSSStyleDeclaration,
    isDark: boolean,
    surfaceBase: string | undefined,
    surfaceTintStyle: SurfaceTintStyle | undefined,
) {
    if (!surfaceBase) {
        style.removeProperty("--surface-base");
        style.removeProperty("--shell-bg");
        style.removeProperty("--shell-bg-vibrancy");
        return;
    }

    style.setProperty("--surface-base", surfaceBase);

    let parsedSurface: {l: number; c: number; h: number; alpha?: number} | null = null;
    try {
        const {l, c, h, alpha} = parseOklch(surfaceBase);
        parsedSurface = {l, c, h, alpha};
    } catch {
        /* keep parsedSurface null */
    }

    // Keep surface tint behavior simple and predictable:
    // constrain input L/C, then derive all outputs directly from that color.
    const tintStyle = surfaceTintStyle ?? "solid";
    const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
    const rawL = parsedSurface?.l ?? (isDark ? 0.3 : 0.8);
    const rawC = parsedSurface?.c ?? 0;
    const rawH = parsedSurface?.h ?? 0;
    const isDesktop = document.documentElement.hasAttribute("data-desktop");
    const minL = isDark ? 0.16 : 0.62;
    const lightMaxL = isDesktop ? 0.9 : 0.95;
    const maxL = isDark ? 0.42 : lightMaxL;
    const baseL = clamp(rawL, minL, maxL);
    const baseC = clamp(rawC, 0, 0.07);
    const baseH = rawH;
    const startL = clamp(baseL + (isDark ? 0.06 : 0.08), minL, maxL);
    const midL = baseL;
    const endMinL = isDark ? 0.1 : 0.56;
    const endL = clamp(baseL - (isDark ? 0.1 : 0.14), endMinL, maxL);
    const start = formatOklch(startL, baseC, baseH);
    const mid = formatOklch(midL, baseC, baseH);
    const end = formatOklch(endL, baseC, baseH);

    style.setProperty("--shell-bg", buildShellBg(tintStyle, start, mid, end));

    // Semi-transparent version for desktop vibrancy (same geometry as shell bg).
    const vibrancyAlpha = isDark ? 0.2 : 0.24;
    const vStart = formatOklch(startL, baseC, baseH, vibrancyAlpha);
    const vMid = formatOklch(midL, baseC, baseH, vibrancyAlpha);
    const vEnd = formatOklch(endL, baseC, baseH, vibrancyAlpha);
    style.setProperty("--shell-bg-vibrancy", buildShellBg(tintStyle, vStart, vMid, vEnd));
}

function applyOverrides(
    overrides: ThemeOverrides,
    mode: ThemeMode,
    previewMode?: ResolvedMode | null,
) {
    const style = document.documentElement.style;
    const isDark = resolveIsDark(mode, previewMode);
    const modeKey: ResolvedMode = isDark ? "dark" : "light";
    const modeOverrides = overrides[modeKey] ?? {};

    applyPaletteOverrides(style, modeOverrides.palette);
    applyNeutralOverrides(
        style,
        modeKey,
        isDark,
        modeOverrides.neutralHue,
        modeOverrides.neutralChroma,
    );
    applySurfaceOverrides(style, isDark, modeOverrides.surfaceBase, modeOverrides.surfaceTintStyle);
}

function clearAllOverrideStyles() {
    const style = document.documentElement.style;
    const paletteColors: PaletteColor[] = [
        "primary",
        "secondary",
        "success",
        "danger",
        "warning",
        "info",
    ];
    for (const name of paletteColors) {
        style.removeProperty(`--palette-${name}`);
        style.removeProperty(`--palette-${name}-fg`);
    }
    for (const token of NEUTRAL_TOKEN_NAMES) {
        style.removeProperty(`--neutral-${token}`);
    }
    style.removeProperty("--neutral-ring-glow");
    style.removeProperty("--surface-base");
    style.removeProperty("--shell-bg");
    style.removeProperty("--shell-bg-vibrancy");
}

// ── Store ────────────────────────────────────────────────────────────────────

export const useThemeStore = create<ThemeState>((set, get) => {
    const initialMode = getStoredTheme();
    const initialOverrides = getStoredOverrides();

    applyTheme(initialMode);
    applyOverrides(initialOverrides, initialMode);

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", () => {
        const {mode, overrides, previewMode} = useThemeStore.getState();
        if (previewMode != null) return;
        // Always re-apply theme so vibrancy mismatch flag stays in sync
        applyTheme(mode);
        if (mode === "system") {
            applyOverrides(overrides, "system");
        }
    });

    return {
        mode: initialMode,
        overrides: initialOverrides,
        previewMode: null,

        setMode: (mode) => {
            localStorage.setItem(THEME_STORAGE_KEY, mode);
            const preview = get().previewMode;
            applyTheme(mode, preview);
            applyOverrides(get().overrides, mode, preview);
            set({mode});
        },

        setOverrides: (overrides) => {
            localStorage.setItem(OVERRIDES_STORAGE_KEY, JSON.stringify(overrides));
            const {mode, previewMode} = get();
            applyOverrides(overrides, mode, previewMode);
            set({overrides});
        },

        resetOverrides: () => {
            localStorage.removeItem(OVERRIDES_STORAGE_KEY);
            clearAllOverrideStyles();
            set({overrides: {}});
        },

        setPreviewMode: (preview) => {
            const {mode, overrides} = get();
            applyTheme(mode, preview);
            applyOverrides(overrides, mode, preview);
            set({previewMode: preview});
        },
    };
});

// ── Exported helpers ─────────────────────────────────────────────────────────

export function safeOklchToHex(oklchStr: string) {
    try {
        const {l, c, h} = parseOklch(oklchStr);
        return oklchToHex(l, c, h);
    } catch {
        return "#808080";
    }
}

export function hasModeOverrides(mo: ModeOverrides | undefined) {
    if (!mo) return false;
    return (
        (mo.palette != null && Object.keys(mo.palette).length > 0) ||
        mo.neutralHue != null ||
        mo.neutralChroma != null ||
        mo.surfaceBase != null ||
        mo.surfaceTintStyle != null
    );
}

// ── Recent colors (localStorage-backed) ──────────────────────────────────────

export function getRecentColors(): string[] {
    try {
        const stored = localStorage.getItem(RECENT_COLORS_KEY);
        if (stored) return JSON.parse(stored);
    } catch {
        /* ignore */
    }
    return [];
}

export function addRecentColor(oklch: string) {
    const recent = getRecentColors().filter((c) => c !== oklch);
    recent.unshift(oklch);
    if (recent.length > MAX_RECENT_COLORS) recent.length = MAX_RECENT_COLORS;
    try {
        localStorage.setItem(RECENT_COLORS_KEY, JSON.stringify(recent));
    } catch {
        /* ignore */
    }
}
