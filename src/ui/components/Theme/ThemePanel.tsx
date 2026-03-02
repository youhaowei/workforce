/**
 * ThemePanel - Right-side panel for live theme customization.
 *
 * Mode-aware: System shows Light+Dark tabs, Light/Dark shows just that mode.
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import { X, RotateCcw, Sun, Moon, Monitor, ChevronRight } from 'lucide-react';
import { Surface } from '@/components/ui/surface';
import { Button } from '@/components/ui/button';
import {
  useThemeStore,
  hasModeOverrides,
  resolveIsDark,
  type ThemeMode,
  type PaletteColor,
  type ModeOverrides,
  type ResolvedMode,
} from '@/ui/stores/useThemeStore';
import { ColorPicker } from './ColorPicker';
import { NeutralPicker } from './NeutralPicker';

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_PALETTE_LIGHT: Record<PaletteColor, string> = {
  primary:   'oklch(0.205 0 0)',
  secondary: 'oklch(0.45 0 0)',
  success:   'oklch(0.59 0.19 149)',
  danger:    'oklch(0.577 0.245 27.325)',
  warning:   'oklch(0.75 0.08 55)',
  info:      'oklch(0.55 0.15 250)',
};

const DEFAULT_PALETTE_DARK: Record<PaletteColor, string> = {
  primary:   'oklch(0.922 0 0)',
  secondary: 'oklch(0.65 0 0)',
  success:   'oklch(0.65 0.19 149)',
  danger:    'oklch(0.704 0.191 22.216)',
  warning:   'oklch(0.75 0.1 70)',
  info:      'oklch(0.65 0.15 250)',
};

const DEFAULT_SURFACE_LIGHT = 'oklch(0.95 0.006 70)';
const DEFAULT_SURFACE_DARK = 'oklch(0.2 0.005 250)';

const PALETTE_ENTRIES: { key: PaletteColor; label: string }[] = [
  { key: 'primary', label: 'Primary' },
  { key: 'secondary', label: 'Secondary' },
  { key: 'success', label: 'Success' },
  { key: 'danger', label: 'Danger' },
  { key: 'warning', label: 'Warning' },
  { key: 'info', label: 'Info' },
];

const MODE_OPTIONS: { value: ThemeMode; icon: typeof Sun; label: string }[] = [
  { value: 'system', icon: Monitor, label: 'System' },
  { value: 'light', icon: Sun, label: 'Light' },
  { value: 'dark', icon: Moon, label: 'Dark' },
];

const PREVIEW_LEVELS_LIGHT = [1.0, 0.98, 0.96, 0.94, 0.92, 0.90, 0.87];
const PREVIEW_LEVELS_DARK = [0.145, 0.17, 0.19, 0.22, 0.24, 0.26, 0.12];

// ── Component ────────────────────────────────────────────────────────────────

export interface ThemePanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ThemePanel({ isOpen, onClose }: ThemePanelProps) {
  const mode = useThemeStore((s) => s.mode);
  const setMode = useThemeStore((s) => s.setMode);
  const overrides = useThemeStore((s) => s.overrides);
  const setOverrides = useThemeStore((s) => s.setOverrides);
  const resetOverrides = useThemeStore((s) => s.resetOverrides);
  const setPreviewMode = useThemeStore((s) => s.setPreviewMode);

  // For system mode, which variant tab is active
  const [activeVariantTab, setActiveVariantTab] = useState<ResolvedMode>(
    () => resolveIsDark(mode) ? 'dark' : 'light',
  );

  // Preview mode: temporarily show the selected variant when in system mode
  const handleVariantTab = useCallback((v: ResolvedMode) => {
    setActiveVariantTab(v);
    setPreviewMode(v);
  }, [setPreviewMode]);

  // Clear preview mode when panel closes
  useEffect(() => {
    if (!isOpen) setPreviewMode(null);
  }, [isOpen, setPreviewMode]);

  // Clear preview when leaving system mode
  useEffect(() => {
    if (mode !== 'system') setPreviewMode(null);
  }, [mode, setPreviewMode]);

  const hasAnyOverrides = hasModeOverrides(overrides.light) || hasModeOverrides(overrides.dark);

  // Which modes to show controls for
  const visibleModes: ResolvedMode[] = mode === 'system'
    ? ['light', 'dark']
    : [mode as ResolvedMode];

  return (
    <Surface
      variant="main"
      data-collapsed={!isOpen}
      className={`flex-shrink-0 flex flex-col select-none rounded-[var(--surface-radius)] m-[0_var(--surface-inset)_var(--surface-inset)_0] transition-[width,margin,opacity] duration-200 ease-in-out ${
        isOpen ? 'w-72 opacity-100' : 'w-0 opacity-0 !m-0 !rounded-none'
      }`}
      aria-hidden={!isOpen}
      inert={!isOpen ? true : undefined}
    >
      {/* Header */}
      <div className="flex items-center h-10 px-3 gap-2 shrink-0">
        <h2 className="text-sm font-semibold text-neutral-fg flex-1 select-none">
          Appearance
        </h2>
        {hasAnyOverrides && (
          <Button
            variant="ghost" size="icon"
            className="h-6 w-6 shrink-0 text-neutral-fg-subtle hover:text-neutral-fg"
            onClick={resetOverrides}
            aria-label="Reset to defaults"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        )}
        <Button
          variant="ghost" size="icon"
          className="h-6 w-6 shrink-0 text-neutral-fg-subtle hover:text-neutral-fg"
          onClick={onClose}
          aria-label="Close theme panel"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto min-h-0 text-sm">
        <div className="p-3 space-y-4">

          {/* ── Theme Mode ────────────────────────────── */}
          <div>
            <SectionLabel>Theme</SectionLabel>
            <div className="flex gap-1 mt-1">
              {MODE_OPTIONS.map(({ value, icon: Icon, label }) => (
                <Button
                  key={value}
                  variant={mode === value ? 'solid' : 'outline'}
                  color={mode === value ? 'primary' : 'neutral'}
                  size="sm"
                  className="flex-1 gap-1.5"
                  onClick={() => setMode(value)}
                >
                  <Icon className="h-3 w-3" />
                  {label}
                </Button>
              ))}
            </div>
          </div>

          {/* ── Variant tabs (system mode only) ───────── */}
          {mode === 'system' && (
            <>
              <div className="flex gap-1">
                {(['light', 'dark'] as ResolvedMode[]).map((v) => {
                  const Icon = v === 'light' ? Sun : Moon;
                  return (
                    <Button
                      key={v}
                      variant={activeVariantTab === v ? 'soft' : 'ghost'}
                      color="neutral"
                      size="sm"
                      className="flex-1 gap-1"
                      onClick={() => handleVariantTab(v)}
                    >
                      <Icon className="h-3 w-3" />
                      {v === 'light' ? 'Light' : 'Dark'}
                    </Button>
                  );
                })}
              </div>
              <ModeControls
                modeKey={activeVariantTab}
                overrides={overrides}
                setOverrides={setOverrides}
              />
            </>
          )}

          {/* ── Single mode controls ──────────────────── */}
          {mode !== 'system' && visibleModes.map((modeKey) => (
            <ModeControls
              key={modeKey}
              modeKey={modeKey}
              overrides={overrides}
              setOverrides={setOverrides}
            />
          ))}
        </div>
      </div>
    </Surface>
  );
}

// ── ModeControls — the color settings for a single light/dark mode ───────────

function ModeControls({
  modeKey,
  overrides,
  setOverrides,
}: {
  modeKey: ResolvedMode;
  overrides: import('@/ui/stores/useThemeStore').ThemeOverrides;
  setOverrides: (o: import('@/ui/stores/useThemeStore').ThemeOverrides) => void;
}) {
  const [expandedSection, setExpandedSection] = useState<string | null>(null);

  const modeOverrides = overrides[modeKey] ?? {};
  const defaultPalette = modeKey === 'light' ? DEFAULT_PALETTE_LIGHT : DEFAULT_PALETTE_DARK;
  const defaultSurface = modeKey === 'light' ? DEFAULT_SURFACE_LIGHT : DEFAULT_SURFACE_DARK;
  const previewLevels = modeKey === 'light' ? PREVIEW_LEVELS_LIGHT : PREVIEW_LEVELS_DARK;

  const neutralHue = modeOverrides.neutralHue ?? 0;
  const neutralChroma = modeOverrides.neutralChroma ?? 0;

  // Only colors the user has actually customized (overrides only, not defaults)
  const usedColors = useMemo(() => {
    const result: { light: string[]; dark: string[] } = { light: [], dark: [] };
    for (const m of ['light', 'dark'] as const) {
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

  const toggleSection = useCallback((section: string) => {
    setExpandedSection((prev) => prev === section ? null : section);
  }, []);

  return (
    <div className="space-y-4">
      {/* ── Accent Colors ─────────────────────────── */}
      <CollapsibleSection
        label="Accent Colors"
        expanded={expandedSection === 'palette'}
        onToggle={() => toggleSection('palette')}
      >
        <div className="space-y-2">
          {PALETTE_ENTRIES.map(({ key, label }) => (
            <ColorPicker
              key={key}
              label={label}
              value={modeOverrides.palette?.[key] ?? defaultPalette[key]}
              onChange={(v) => updatePalette(key, v)}
              usedColors={usedColors}
            />
          ))}
        </div>
      </CollapsibleSection>

      {/* ── Neutral Tones ─────────────────────────── */}
      <CollapsibleSection
        label="Neutral Tones"
        expanded={expandedSection === 'neutrals'}
        onToggle={() => toggleSection('neutrals')}
      >
        <NeutralPicker
          hue={neutralHue}
          chroma={neutralChroma}
          onHueChange={(v) => updateModeOverride({ neutralHue: v })}
          onChromaChange={(v) => updateModeOverride({ neutralChroma: v })}
          previewLevels={previewLevels}
          isDark={modeKey === 'dark'}
        />
      </CollapsibleSection>

      {/* ── Surface Tint ──────────────────────────── */}
      <div>
        <SectionLabel>Surface Tint</SectionLabel>
        <div className="mt-1">
          <ColorPicker
            value={modeOverrides.surfaceBase ?? defaultSurface}
            onChange={(v) => updateModeOverride({ surfaceBase: v })}
            usedColors={usedColors}
          />
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="text-xs font-medium text-neutral-fg-subtle">
      {children}
    </label>
  );
}

function CollapsibleSection({
  label,
  expanded,
  onToggle,
  children,
}: {
  label: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-1.5 w-full py-1 text-xs font-medium text-neutral-fg-subtle cursor-pointer hover:text-neutral-fg transition-colors"
      >
        <ChevronRight
          className={`h-3 w-3 transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
        />
        {label}
      </button>
      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-in-out ${
          expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="overflow-hidden">
          <div className="pt-1 pb-2">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
