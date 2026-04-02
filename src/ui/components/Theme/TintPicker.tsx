/**
 * TintPicker — Hue wheel + brightness slider for surface tints.
 *
 * Optimized for picking tint colors where hue is the primary axis
 * and brightness is secondary. Chroma is kept low (tint-appropriate).
 */

import { useCallback, useEffect, useRef } from "react";
import { RotateCcw } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { parseOklch, formatOklch, oklchToHex } from "@/ui/lib/oklch";
import { addRecentColor } from "@/ui/stores/useThemeStore";
import { usePlatform } from "@/ui/context/PlatformProvider";

const WHEEL_SIZE = 160;
const WHEEL_RADIUS = WHEEL_SIZE / 2;
const RING_WIDTH = 22;
const INNER_RADIUS = WHEEL_RADIUS - RING_WIDTH;
const SLIDER_W = WHEEL_SIZE;
const SLIDER_H = 14;
const TINT_CHROMA = 0.03;

interface TintPickerProps {
  value: string;
  onChange: (oklch: string) => void;
  showHexValue?: boolean;
}

export function TintPicker({ value, onChange, showHexValue = true }: TintPickerProps) {
  const { isDesktop } = usePlatform();
  const effectivePreviewBackground = isDesktop
    ? "var(--shell-bg-vibrancy, var(--shell-bg))"
    : "var(--shell-bg)";

  let lch = { l: 0.8, c: TINT_CHROMA, h: 0 };
  try {
    lch = parseOklch(value);
  } catch {
    /* keep default */
  }

  const snapshotRef = useRef<string | null>(null);
  const chromaStrength = Math.max(0, Math.min(1, lch.c / 0.08));
  const softenedChroma = lch.c * (1 - chromaStrength * 0.45);
  const previewChroma = Math.max(0.002, Math.min(TINT_CHROMA, softenedChroma));

  const emit = useCallback(
    (l: number, c: number, h: number) => onChange(formatOklch(l, c, h)),
    [onChange],
  );

  const handleReset = useCallback(() => {
    if (snapshotRef.current != null) onChange(snapshotRef.current);
  }, [onChange]);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        snapshotRef.current = value;
      } else {
        addRecentColor(value);
      }
    },
    [value],
  );

  return (
    <div className="flex items-center gap-2">
      <Popover onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="w-7 h-7 rounded-md border border-neutral-border shrink-0 cursor-pointer transition-shadow hover:ring-2 hover:ring-neutral-ring/30"
            style={{ background: effectivePreviewBackground }}
            aria-label="Pick surface tint"
          />
        </PopoverTrigger>
        <PopoverContent side="left" align="start" className="w-auto p-3 space-y-3">
          <HueWheel
            hue={lch.h}
            previewBackground={effectivePreviewBackground}
            ringChroma={previewChroma}
            onChangeHue={(h) => emit(lch.l, TINT_CHROMA, h)}
          />
          <BrightnessSlider
            lightness={lch.l}
            hue={lch.h}
            chroma={previewChroma}
            onChangeLightness={(l) => emit(l, TINT_CHROMA, lch.h)}
          />
          <div className="flex items-center gap-2">
            <div
              className="w-6 h-6 rounded-[4px] border border-neutral-border shrink-0"
              style={{ background: effectivePreviewBackground }}
            />
            <button
              type="button"
              onClick={handleReset}
              className="w-6 h-6 ml-auto flex items-center justify-center rounded-md text-neutral-fg-subtle hover:text-neutral-fg hover:bg-neutral-bg-subtle transition-colors"
              title="Reset to value before opening"
            >
              <RotateCcw className="w-3 h-3" />
            </button>
          </div>
        </PopoverContent>
      </Popover>
      {showHexValue && (
        <input
          type="text"
          value={value}
          readOnly
          className="w-[72px] h-7 px-2 text-[11px] font-mono rounded-md border border-neutral-border bg-neutral-bg text-neutral-fg-subtle"
          spellCheck={false}
        />
      )}
    </div>
  );
}

// ── Hue Wheel ──────────────────────────────────────────────────────────────

function HueWheel({
  hue,
  previewBackground,
  ringChroma,
  onChangeHue,
}: {
  hue: number;
  previewBackground: string;
  ringChroma: number;
  onChangeHue: (h: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement | undefined>(undefined);

  // Render hue ring
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = WHEEL_SIZE * dpr;
    canvas.height = WHEEL_SIZE * dpr;
    ctx.scale(dpr, dpr);

    // Draw hue ring using arc segments
    const segments = 360;
    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2 - Math.PI / 2;
      const nextAngle = ((i + 1) / segments) * Math.PI * 2 - Math.PI / 2;
      const h = (i / segments) * 360;

      ctx.beginPath();
      ctx.arc(WHEEL_RADIUS, WHEEL_RADIUS, WHEEL_RADIUS - 1, angle, nextAngle + 0.02);
      ctx.arc(WHEEL_RADIUS, WHEEL_RADIUS, INNER_RADIUS, nextAngle + 0.02, angle, true);
      ctx.closePath();
      ctx.fillStyle = oklchToHex(0.68, ringChroma, h);
      ctx.fill();
    }

    // Mask center to transparent
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.arc(WHEEL_RADIUS, WHEEL_RADIUS, INNER_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
  }, [ringChroma]);

  const angleFromEvent = useCallback((e: React.PointerEvent | PointerEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let angle = Math.atan2(e.clientY - cy, e.clientX - cx);
    // Rotate so 0° is at top
    angle += Math.PI / 2;
    if (angle < 0) angle += Math.PI * 2;
    return (angle / (Math.PI * 2)) * 360;
  }, []);

  const handlePointer = useCallback(
    (e: React.PointerEvent | PointerEvent) => {
      const h = angleFromEvent(e);
      if (h != null) onChangeHue(h);
    },
    [angleFromEvent, onChangeHue],
  );

  const startDrag = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      handlePointer(e);
    },
    [handlePointer],
  );

  // Handle position on the ring
  const handleAngle = (hue / 360) * Math.PI * 2 - Math.PI / 2;
  const handleDist = INNER_RADIUS + RING_WIDTH / 2;
  const handleX = WHEEL_RADIUS + Math.cos(handleAngle) * handleDist;
  const handleY = WHEEL_RADIUS + Math.sin(handleAngle) * handleDist;

  return (
    <div
      ref={containerRef as React.RefObject<HTMLDivElement>}
      className="relative cursor-crosshair"
      style={{ width: WHEEL_SIZE, height: WHEEL_SIZE }}
      onPointerDown={startDrag}
      onPointerMove={(e) => {
        if (e.buttons > 0) handlePointer(e);
      }}
    >
      <canvas
        ref={canvasRef as React.RefObject<HTMLCanvasElement>}
        className="block"
        style={{ width: WHEEL_SIZE, height: WHEEL_SIZE }}
      />
      {/* Center preview */}
      <div
        className="absolute rounded-full border border-neutral-border"
        style={{
          width: INNER_RADIUS * 2 - 16,
          height: INNER_RADIUS * 2 - 16,
          left: WHEEL_RADIUS - (INNER_RADIUS - 8),
          top: WHEEL_RADIUS - (INNER_RADIUS - 8),
          background: previewBackground,
        }}
      />
      {/* Ring handle */}
      <div
        className="absolute pointer-events-none"
        style={{ left: handleX, top: handleY, transform: "translate(-50%, -50%)" }}
      >
        <div className="w-4 h-4 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.3),0_1px_3px_rgba(0,0,0,0.4)]" />
      </div>
    </div>
  );
}

// ── Brightness Slider ──────────────────────────────────────────────────────

function BrightnessSlider({
  lightness,
  hue,
  chroma,
  onChangeLightness,
}: {
  lightness: number;
  hue: number;
  chroma: number;
  onChangeLightness: (l: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement | undefined>(undefined);

  const handlePointer = useCallback(
    (e: React.PointerEvent | PointerEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      onChangeLightness(x);
    },
    [onChangeLightness],
  );

  const startDrag = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      handlePointer(e);
    },
    [handlePointer],
  );

  // Build brightness gradient: black → hue → white
  const darkHex = oklchToHex(0.05, 0, hue);
  const midHex = oklchToHex(0.5, chroma, hue);
  const lightHex = oklchToHex(0.95, chroma * 0.3, hue);

  return (
    <div
      ref={containerRef as React.RefObject<HTMLDivElement>}
      className="relative cursor-pointer rounded-full overflow-hidden border border-neutral-border"
      style={{
        width: SLIDER_W,
        height: SLIDER_H,
        background: `linear-gradient(to right, ${darkHex}, ${midHex}, ${lightHex})`,
      }}
      onPointerDown={startDrag}
      onPointerMove={(e) => {
        if (e.buttons > 0) handlePointer(e);
      }}
    >
      <div
        className="absolute top-0 pointer-events-none"
        style={{ left: `${lightness * 100}%`, transform: "translateX(-50%)" }}
      >
        <div
          className="rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.3)]"
          style={{ width: SLIDER_H - 2, height: SLIDER_H - 2 }}
        />
      </div>
    </div>
  );
}
