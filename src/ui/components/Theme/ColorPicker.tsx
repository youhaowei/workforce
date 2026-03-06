/**
 * ColorPicker — OKLch-native color picker.
 *
 * Compact swatch + hex inline. Clicking the swatch opens a popover with:
 * - 2D gradient area (lightness × chroma) rendered on canvas
 * - Hue strip slider
 * - Hex text input
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { parseOklch, formatOklch, oklchToHex, hexToOklch } from '@/ui/lib/oklch';
import { safeOklchToHex, getRecentColors, addRecentColor } from '@/ui/stores/useThemeStore';

const AREA_W = 192;
const AREA_H = 144;
const HUE_H = 14;
const DEFAULT_MAX_CHROMA = 0.35;
const DEFAULT_HUE_STRIP_CHROMA = 0.15;
const DEFAULT_MIN_LIGHTNESS = 0;
const DEFAULT_MAX_LIGHTNESS = 1;

export interface UsedColorSet {
  light: string[];
  dark: string[];
}

interface ColorPickerProps {
  value: string;
  onChange: (oklch: string) => void;
  label?: string;
  /** Optional applied preview background (e.g. blended shell tint). */
  previewBackground?: string;
  /** Optional action for clicking the applied preview swatch. */
  onPreviewClick?: () => void;
  /** Max chroma shown in gradient area (lower for tint workflows). */
  maxChroma?: number;
  /** Chroma shown in hue strip gradient. */
  hueStripChroma?: number;
  /** Lightness bounds used by gradient area. */
  minLightness?: number;
  maxLightness?: number;
  /** Show used-colors rows (Light/Dark) in popover. */
  showUsedColors?: boolean;
  /** Show/persist recent colors row in popover. */
  showRecentColors?: boolean;
  /** Show hex inputs inline and in popover. */
  showHexValue?: boolean;
  /** Colors currently in use across the theme, split by mode */
  usedColors?: UsedColorSet;
}

export function ColorPicker({
  value,
  onChange,
  label,
  previewBackground,
  onPreviewClick,
  maxChroma = DEFAULT_MAX_CHROMA,
  hueStripChroma = DEFAULT_HUE_STRIP_CHROMA,
  minLightness = DEFAULT_MIN_LIGHTNESS,
  maxLightness = DEFAULT_MAX_LIGHTNESS,
  showUsedColors = true,
  showRecentColors = true,
  showHexValue = true,
  usedColors,
}: ColorPickerProps) {
  const hex = safeOklchToHex(value);
  const previewBg = previewBackground ?? hex;
  const lightnessLow = Math.min(minLightness, maxLightness);
  const lightnessHigh = Math.max(minLightness, maxLightness);
  const clampLightness = useCallback(
    (l: number) => Math.max(lightnessLow, Math.min(lightnessHigh, l)),
    [lightnessLow, lightnessHigh],
  );
  const clampChroma = useCallback(
    (c: number) => Math.max(0, Math.min(maxChroma, c)),
    [maxChroma],
  );

  let lch = { l: 0.5, c: 0.1, h: 0 };
  try { lch = parseOklch(value); } catch { /* keep default */ }
  const uiLch = {
    l: clampLightness(lch.l),
    c: clampChroma(lch.c),
    h: lch.h,
  };

  const [hexText, setHexText] = useState(hex);
  useEffect(() => { setHexText(hex); }, [hex]);

  const [recentColors, setRecentColors] = useState<string[]>([]);
  const snapshotRef = useRef<string | null>(null);

  const emit = useCallback(
    (l: number, c: number, h: number) => onChange(formatOklch(clampLightness(l), clampChroma(c), h)),
    [onChange, clampLightness, clampChroma],
  );

  const handleHexInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      setHexText(raw);
      if (/^#[0-9a-fA-F]{6}$/.test(raw)) {
        const parsed = hexToOklch(raw);
        emit(parsed.l, parsed.c, parsed.h);
      }
    },
    [emit],
  );

  const handleSwatchClick = useCallback(
    (oklch: string) => onChange(oklch),
    [onChange],
  );

  const handleReset = useCallback(() => {
    if (snapshotRef.current != null) onChange(snapshotRef.current);
  }, [onChange]);

  const handleOpenChange = useCallback((open: boolean) => {
    if (open) {
      snapshotRef.current = value;
      if (showRecentColors) {
        setRecentColors(getRecentColors());
      } else {
        setRecentColors([]);
      }
    } else {
      if (showRecentColors) {
        addRecentColor(value);
        setRecentColors(getRecentColors());
      }
    }
  }, [value, showRecentColors]);

  // Used colors minus current value; recent minus anything already in used/current
  const dedupedLight = usedColors?.light.filter((c) => c !== value);
  const dedupedDark = usedColors?.dark.filter((c) => c !== value);
  const allUsed = new Set([...(usedColors?.light ?? []), ...(usedColors?.dark ?? [])]);
  allUsed.add(value);
  const dedupedRecent = recentColors.filter((c) => !allUsed.has(c));

  return (
    <div className="flex items-center gap-2">
      {label && (
        <span className="text-[11px] text-neutral-fg-subtle w-20 shrink-0">{label}</span>
      )}
      <Popover onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="w-7 h-7 rounded-md border border-neutral-border shrink-0 cursor-pointer transition-shadow hover:ring-2 hover:ring-neutral-ring/30"
            style={{ background: previewBg }}
            aria-label={`Pick ${label ?? 'color'}`}
          />
        </PopoverTrigger>
        <PopoverContent
          side="left"
          align="start"
          className="w-auto p-2 space-y-2"
        >
          <GradientArea
            lightness={uiLch.l}
            chroma={uiLch.c}
            hue={uiLch.h}
            maxChroma={maxChroma}
            minLightness={lightnessLow}
            maxLightness={lightnessHigh}
            onChangeLC={(l, c) => emit(l, c, lch.h)}
          />
          <HueStrip
            hue={uiLch.h}
            stripChroma={hueStripChroma}
            onChangeHue={(h) => emit(lch.l, lch.c, h)}
          />
          <PopoverControls
            previewBg={previewBg}
            previewBackground={previewBackground}
            onPreviewClick={onPreviewClick}
            showHexValue={showHexValue}
            hexText={hexText}
            onHexInput={handleHexInput}
            onReset={handleReset}
            uiLch={uiLch}
          />
          <SwatchSection
            showUsedColors={showUsedColors}
            showRecentColors={showRecentColors}
            dedupedLight={dedupedLight}
            dedupedDark={dedupedDark}
            dedupedRecent={dedupedRecent}
            onPick={handleSwatchClick}
          />
        </PopoverContent>
      </Popover>
      {showHexValue && (
        <input
          type="text"
          value={hexText}
          onChange={handleHexInput}
          className="w-[72px] h-7 px-2 text-[11px] font-mono rounded-md border border-neutral-border bg-neutral-bg text-neutral-fg focus:outline-none focus:ring-1 focus:ring-neutral-ring"
          spellCheck={false}
        />
      )}
    </div>
  );
}

// ── Swatch Row ──────────────────────────────────────────────────────────────

function SwatchRow({ label, colors, onPick }: { label: string; colors: string[]; onPick: (c: string) => void }) {
  return (
    <div className="space-y-1">
      <span className="text-[10px] text-neutral-fg-subtle">{label}</span>
      <div className="flex flex-wrap gap-1">
        {colors.map((oklch) => (
          <button
            key={oklch}
            type="button"
            onClick={() => onPick(oklch)}
            className="w-5 h-5 rounded-[3px] border border-neutral-border cursor-pointer transition-shadow hover:ring-1 hover:ring-neutral-ring/30"
            style={{ background: safeOklchToHex(oklch) }}
            title={safeOklchToHex(oklch)}
          />
        ))}
      </div>
    </div>
  );
}

// ── Popover Controls Row ─────────────────────────────────────────────────────

function PopoverControls({
  previewBg,
  previewBackground,
  onPreviewClick,
  showHexValue,
  hexText,
  onHexInput,
  onReset,
  uiLch,
}: {
  previewBg: string;
  previewBackground?: string;
  onPreviewClick?: () => void;
  showHexValue?: boolean;
  hexText: string;
  onHexInput: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onReset: () => void;
  uiLch: { l: number; c: number; h: number };
}) {
  return (
    <>
      <div className="flex items-center gap-2">
        <div
          className="w-6 h-6 rounded-[4px] border border-neutral-border shrink-0"
          style={{ background: previewBg }}
        />
        {previewBackground && (
          onPreviewClick ? (
            <button
              type="button"
              onClick={onPreviewClick}
              className="h-6 flex-1 min-w-[64px] rounded-[4px] border border-neutral-border-subtle cursor-pointer transition-shadow hover:ring-1 hover:ring-neutral-ring/30"
              style={{ background: previewBg }}
              title="Applied preview (click to cycle tint style)"
            />
          ) : (
            <div
              className="h-6 flex-1 min-w-[64px] rounded-[4px] border border-neutral-border-subtle"
              style={{ background: previewBg }}
              title="Applied preview"
            />
          )
        )}
        {showHexValue && (
          <input
            type="text"
            value={hexText}
            onChange={onHexInput}
            className="flex-1 h-6 px-2 text-[11px] font-mono rounded-md border border-neutral-border bg-neutral-bg text-neutral-fg focus:outline-none focus:ring-1 focus:ring-neutral-ring"
            spellCheck={false}
          />
        )}
        <button
          type="button"
          onClick={onReset}
          className={`w-6 h-6 flex items-center justify-center rounded-md text-neutral-fg-subtle hover:text-neutral-fg hover:bg-neutral-bg-subtle transition-colors ${showHexValue ? '' : 'ml-auto'}`}
          title="Reset to value before opening"
        >
          <RotateCcw className="w-3 h-3" />
        </button>
      </div>
      <div className="text-[10px] text-neutral-fg-subtle font-mono tabular-nums">
        L{(uiLch.l * 100).toFixed(0)} C{(uiLch.c * 100).toFixed(0)} H{Math.round(uiLch.h)}
      </div>
    </>
  );
}

// ── Swatch Section ────────────────────────────────────────────────────────────

function SwatchSection({
  showUsedColors,
  showRecentColors,
  dedupedLight,
  dedupedDark,
  dedupedRecent,
  onPick,
}: {
  showUsedColors?: boolean;
  showRecentColors?: boolean;
  dedupedLight?: string[];
  dedupedDark?: string[];
  dedupedRecent: string[];
  onPick: (c: string) => void;
}) {
  return (
    <>
      {showUsedColors && dedupedLight && dedupedLight.length > 0 && (
        <SwatchRow label="Light" colors={dedupedLight} onPick={onPick} />
      )}
      {showUsedColors && dedupedDark && dedupedDark.length > 0 && (
        <SwatchRow label="Dark" colors={dedupedDark} onPick={onPick} />
      )}
      {showRecentColors && dedupedRecent.length > 0 && (
        <SwatchRow label="Recent" colors={dedupedRecent} onPick={onPick} />
      )}
    </>
  );
}

// ── 2D Gradient Area (Lightness × Chroma) ────────────────────────────────────

function GradientArea({
  lightness,
  chroma,
  hue,
  maxChroma,
  minLightness,
  maxLightness,
  onChangeLC,
}: {
  lightness: number;
  chroma: number;
  hue: number;
  maxChroma: number;
  minLightness: number;
  maxLightness: number;
  onChangeLC: (l: number, c: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement | undefined>(undefined);

  // Render gradient onto canvas whenever hue changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = ctx.createImageData(AREA_W, AREA_H);
    for (let y = 0; y < AREA_H; y++) {
      const t = y / (AREA_H - 1);
      const l = maxLightness - t * (maxLightness - minLightness);
      for (let x = 0; x < AREA_W; x++) {
        const c = (x / (AREA_W - 1)) * maxChroma;
        const hexStr = oklchToHex(l, c, hue);
        const i = (y * AREA_W + x) * 4;
        img.data[i] = parseInt(hexStr.slice(1, 3), 16);
        img.data[i + 1] = parseInt(hexStr.slice(3, 5), 16);
        img.data[i + 2] = parseInt(hexStr.slice(5, 7), 16);
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [hue, maxChroma, minLightness, maxLightness]);

  const handlePointer = useCallback(
    (e: React.PointerEvent | PointerEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
      const l = maxLightness - y * (maxLightness - minLightness);
      onChangeLC(l, x * maxChroma);
    },
    [onChangeLC, maxChroma, minLightness, maxLightness],
  );

  const startDrag = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      handlePointer(e);
    },
    [handlePointer],
  );

  // Handle position as percentages
  const handleX = Math.min(100, Math.max(0, (chroma / maxChroma) * 100));
  const lightnessRange = Math.max(0.0001, maxLightness - minLightness);
  const handleY = Math.min(
    100,
    Math.max(0, ((maxLightness - lightness) / lightnessRange) * 100),
  );

  return (
    <div
      ref={containerRef as React.RefObject<HTMLDivElement>}
      className="relative cursor-crosshair rounded-md overflow-hidden border border-neutral-border"
      style={{ width: AREA_W, height: AREA_H }}
      onPointerDown={startDrag}
      onPointerMove={(e) => { if (e.buttons > 0) handlePointer(e); }}
    >
      <canvas
        ref={canvasRef as React.RefObject<HTMLCanvasElement>}
        width={AREA_W}
        height={AREA_H}
        className="block w-full h-full"
      />
      {/* Crosshair handle */}
      <div
        className="absolute pointer-events-none"
        style={{ left: `${handleX}%`, top: `${handleY}%`, transform: 'translate(-50%, -50%)' }}
      >
        <div className="w-3.5 h-3.5 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.3),0_1px_3px_rgba(0,0,0,0.4)]" />
      </div>
    </div>
  );
}

// ── Hue Strip ────────────────────────────────────────────────────────────────

function HueStrip({
  hue,
  stripChroma,
  onChangeHue,
}: {
  hue: number;
  stripChroma: number;
  onChangeHue: (h: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement | undefined>(undefined);

  const handlePointer = useCallback(
    (e: React.PointerEvent | PointerEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      onChangeHue(x * 360);
    },
    [onChangeHue],
  );

  const startDrag = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      handlePointer(e);
    },
    [handlePointer],
  );

  // Build hue gradient stops
  const stops = Array.from({ length: 7 }, (_, i) => {
    const h = (i / 6) * 360;
    return `oklch(0.7 ${stripChroma} ${h})`;
  }).join(', ');

  return (
    <div
      ref={containerRef as React.RefObject<HTMLDivElement>}
      className="relative cursor-pointer rounded-full overflow-hidden border border-neutral-border"
      style={{ width: AREA_W, height: HUE_H, background: `linear-gradient(to right, ${stops})` }}
      onPointerDown={startDrag}
      onPointerMove={(e) => { if (e.buttons > 0) handlePointer(e); }}
    >
      <div
        className="absolute top-0 pointer-events-none"
        style={{ left: `${(hue / 360) * 100}%`, transform: 'translateX(-50%)' }}
      >
        <div
          className="rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.3)]"
          style={{ width: HUE_H - 2, height: HUE_H - 2 }}
        />
      </div>
    </div>
  );
}
