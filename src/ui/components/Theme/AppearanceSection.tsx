import { useCallback, useMemo, useState } from "react";
import { Sun, Moon, Monitor, RotateCcw, ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  useThemeStore,
  hasModeOverrides,
  resolveIsDark,
  type ThemeMode,
  type PaletteColor,
  type ModeOverrides,
  type ResolvedMode,
  type SurfaceTintStyle,
} from "@/ui/stores/useThemeStore";
import { ColorPicker } from "./ColorPicker";
import { NeutralPicker } from "./NeutralPicker";
import { TintPicker } from "./TintPicker";
import {
  DEFAULT_PALETTE_LIGHT,
  DEFAULT_PALETTE_DARK,
  DEFAULT_SURFACE_LIGHT,
  DEFAULT_SURFACE_DARK,
  PREVIEW_LEVELS_LIGHT,
  PREVIEW_LEVELS_DARK,
} from "./theme-defaults";

const PALETTE_LABELS: Record<PaletteColor, string> = {
  primary: "Primary",
  secondary: "Secondary",
  success: "Success",
  danger: "Danger",
  warning: "Warning",
  info: "Info",
};

const MODE_OPTIONS: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];
const SURFACE_TINT_STYLES: { value: SurfaceTintStyle; label: string }[] = [
  { value: "solid", label: "Solid" },
  { value: "gradient2", label: "2-Stop" },
  { value: "gradient3", label: "3-Stop" },
];

export function AppearanceSection() {
  const mode = useThemeStore((s) => s.mode);
  const setMode = useThemeStore((s) => s.setMode);
  const overrides = useThemeStore((s) => s.overrides);
  const setOverrides = useThemeStore((s) => s.setOverrides);
  const resetOverrides = useThemeStore((s) => s.resetOverrides);

  const [activeVariantTab, setActiveVariantTab] = useState<ResolvedMode>(() =>
    resolveIsDark(mode) ? "dark" : "light",
  );

  const hasAnyOverrides = hasModeOverrides(overrides.light) || hasModeOverrides(overrides.dark);

  // Which mode keys to show controls for
  const visibleModes: ResolvedMode[] =
    mode === "system" ? ["light", "dark"] : [mode as ResolvedMode];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-semibold">Appearance</Label>
        {hasAnyOverrides && (
          <Button variant="ghost" size="xs" onClick={resetOverrides}>
            <RotateCcw className="h-3 w-3" />
            Reset
          </Button>
        )}
      </div>

      {/* Theme Mode */}
      <div className="space-y-1.5">
        <Label className="text-xs text-neutral-fg-subtle">Theme</Label>
        <div className="flex gap-1.5">
          {MODE_OPTIONS.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                mode === value
                  ? "bg-palette-primary text-palette-primary-fg border-palette-primary"
                  : "bg-neutral-bg-subtle text-neutral-fg-subtle border-neutral-border hover:border-neutral-ring"
              }`}
            >
              <Icon className="h-3 w-3" />
              {label}
            </button>
          ))}
        </div>
      </div>

      <Separator />

      {/* Variant tabs for system mode */}
      {mode === "system" && (
        <div className="flex gap-1.5">
          {(["light", "dark"] as ResolvedMode[]).map((v) => {
            const Icon = v === "light" ? Sun : Moon;
            return (
              <button
                key={v}
                type="button"
                onClick={() => setActiveVariantTab(v)}
                className={`flex items-center gap-1 px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  activeVariantTab === v
                    ? "bg-neutral-bg-emphasis text-neutral-fg"
                    : "text-neutral-fg-subtle hover:text-neutral-fg"
                }`}
              >
                <Icon className="h-3 w-3" />
                {v === "light" ? "Light" : "Dark"}
              </button>
            );
          })}
        </div>
      )}

      {/* Per-mode controls */}
      {mode === "system" ? (
        <ModeColorControls
          modeKey={activeVariantTab}
          overrides={overrides}
          setOverrides={setOverrides}
        />
      ) : (
        visibleModes.map((modeKey) => (
          <ModeColorControls
            key={modeKey}
            modeKey={modeKey}
            overrides={overrides}
            setOverrides={setOverrides}
          />
        ))
      )}
    </div>
  );
}

// ── Per-mode color controls ──────────────────────────────────────────────────

function ModeColorControls({
  modeKey,
  overrides,
  setOverrides,
}: {
  modeKey: ResolvedMode;
  overrides: import("@/ui/stores/useThemeStore").ThemeOverrides;
  setOverrides: (o: import("@/ui/stores/useThemeStore").ThemeOverrides) => void;
}) {
  const modeOverrides = overrides[modeKey] ?? {};
  const defaultPalette = modeKey === "light" ? DEFAULT_PALETTE_LIGHT : DEFAULT_PALETTE_DARK;
  const defaultSurface = modeKey === "light" ? DEFAULT_SURFACE_LIGHT : DEFAULT_SURFACE_DARK;
  const previewLevels = modeKey === "light" ? PREVIEW_LEVELS_LIGHT : PREVIEW_LEVELS_DARK;
  const surfaceTintStyle = modeOverrides.surfaceTintStyle ?? "solid";

  // Only colors the user has actually customized (overrides only, not defaults)
  const usedColors = useMemo(() => {
    const result: { light: string[]; dark: string[] } = { light: [], dark: [] };
    for (const m of ["light", "dark"] as const) {
      const mo = overrides[m] ?? {};
      if (mo.palette) {
        for (const v of Object.values(mo.palette)) {
          if (v) result[m].push(v);
        }
      }
      if (mo.surfaceBase) result[m].push(mo.surfaceBase);
    }
    return result;
  }, [overrides]);

  const updateModeOverride = useCallback(
    (patch: Partial<ModeOverrides>) => {
      const current = useThemeStore.getState().overrides;
      const currentMode = current[modeKey] ?? {};
      setOverrides({ ...current, [modeKey]: { ...currentMode, ...patch } });
    },
    [modeKey, setOverrides],
  );

  const updatePalette = useCallback(
    (color: PaletteColor, value: string) => {
      const current = useThemeStore.getState().overrides;
      const currentMode = current[modeKey] ?? {};
      setOverrides({
        ...current,
        [modeKey]: { ...currentMode, palette: { ...currentMode.palette, [color]: value } },
      });
    },
    [modeKey, setOverrides],
  );

  return (
    <div className="space-y-3">
      {/* Accent Colors */}
      <Collapsible>
        <CollapsibleTrigger className="flex items-center gap-1.5 w-full group cursor-pointer">
          <ChevronDown className="h-3 w-3 text-neutral-fg-subtle transition-transform group-data-[state=closed]:-rotate-90" />
          <Label className="text-xs text-neutral-fg-subtle cursor-pointer">Accent Colors</Label>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="space-y-2 pt-2">
            {(Object.keys(PALETTE_LABELS) as PaletteColor[]).map((color) => (
              <ColorPicker
                key={color}
                label={PALETTE_LABELS[color]}
                value={modeOverrides.palette?.[color] ?? defaultPalette[color]}
                onChange={(v) => updatePalette(color, v)}
                usedColors={usedColors}
              />
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>

      <Separator />

      {/* Neutral Family */}
      <Collapsible>
        <CollapsibleTrigger className="flex items-center gap-1.5 w-full group cursor-pointer">
          <ChevronDown className="h-3 w-3 text-neutral-fg-subtle transition-transform group-data-[state=closed]:-rotate-90" />
          <Label className="text-xs text-neutral-fg-subtle cursor-pointer">Neutral Tones</Label>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="pt-2">
            <NeutralPicker
              hue={modeOverrides.neutralHue ?? 0}
              chroma={modeOverrides.neutralChroma ?? 0}
              onHueChange={(v) => updateModeOverride({ neutralHue: v })}
              onChromaChange={(v) => updateModeOverride({ neutralChroma: v })}
              previewLevels={previewLevels}
              isDark={modeKey === "dark"}
            />
          </div>
        </CollapsibleContent>
      </Collapsible>

      <Separator />

      {/* Surface Tint */}
      <div className="space-y-1.5">
        <Label className="text-xs text-neutral-fg-subtle">Surface Tint</Label>
        <TintPicker
          value={modeOverrides.surfaceBase ?? defaultSurface}
          onChange={(v) => updateModeOverride({ surfaceBase: v })}
        />
        <div className="flex gap-1.5 pt-1">
          {SURFACE_TINT_STYLES.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => updateModeOverride({ surfaceTintStyle: value })}
              className={`flex-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ${
                surfaceTintStyle === value
                  ? "bg-palette-primary text-palette-primary-fg border-palette-primary"
                  : "bg-neutral-bg-subtle text-neutral-fg-subtle border-neutral-border hover:border-neutral-ring"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
