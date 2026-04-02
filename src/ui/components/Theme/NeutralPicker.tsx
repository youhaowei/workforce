/**
 * NeutralPicker — 2D square picker for neutral hue × chroma.
 *
 * X-axis = hue (0–360), Y-axis = chroma (0–0.03).
 * Canvas renders a preview at L=0.7 so the tonal character is visible.
 * Presets and a tonal preview strip sit below.
 */

import { useCallback, useEffect, useRef } from "react";
import { formatOklch, oklchToHex } from "@/ui/lib/oklch";

interface NeutralPickerProps {
  hue: number;
  chroma: number;
  onHueChange: (hue: number) => void;
  onChromaChange: (chroma: number) => void;
  /** Lightness levels for the tonal preview strip */
  previewLevels: number[];
  /** Whether this picker is for dark mode (affects canvas rendering lightness) */
  isDark?: boolean;
}

const PRESETS = [
  { label: "Gray", hue: 0, chroma: 0 },
  { label: "Warm", hue: 70, chroma: 0.006 },
  { label: "Cool", hue: 250, chroma: 0.005 },
  { label: "Slate", hue: 240, chroma: 0.01 },
] as const;

const AREA_W = 192;
const AREA_H = 96;
const MAX_CHROMA = 0.03;
const CANVAS_L_LIGHT = 0.7;
const CANVAS_L_DARK = 0.25;

export function NeutralPicker({
  hue,
  chroma,
  onHueChange,
  onChromaChange,
  previewLevels,
  isDark = false,
}: NeutralPickerProps) {
  const canvasL = isDark ? CANVAS_L_DARK : CANVAS_L_LIGHT;
  const canvasRef = useRef<HTMLCanvasElement | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement | undefined>(undefined);

  // Render 2D gradient: X=hue, Y=chroma (top=max, bottom=0)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = ctx.createImageData(AREA_W, AREA_H);
    for (let y = 0; y < AREA_H; y++) {
      const c = (1 - y / (AREA_H - 1)) * MAX_CHROMA; // top = max chroma
      for (let x = 0; x < AREA_W; x++) {
        const h = (x / (AREA_W - 1)) * 360;
        const hexStr = oklchToHex(canvasL, c, h);
        const i = (y * AREA_W + x) * 4;
        img.data[i] = parseInt(hexStr.slice(1, 3), 16);
        img.data[i + 1] = parseInt(hexStr.slice(3, 5), 16);
        img.data[i + 2] = parseInt(hexStr.slice(5, 7), 16);
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [canvasL]);

  const handlePointer = useCallback(
    (e: React.PointerEvent | PointerEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
      onHueChange(x * 360);
      onChromaChange((1 - y) * MAX_CHROMA);
    },
    [onHueChange, onChromaChange],
  );

  const startDrag = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      handlePointer(e);
    },
    [handlePointer],
  );

  const handlePreset = useCallback(
    (preset: (typeof PRESETS)[number]) => {
      onHueChange(preset.hue);
      onChromaChange(preset.chroma);
    },
    [onHueChange, onChromaChange],
  );

  // Handle position as percentages
  const handleX = Math.min(100, Math.max(0, (hue / 360) * 100));
  const handleY = Math.min(100, Math.max(0, (1 - chroma / MAX_CHROMA) * 100));

  return (
    <div className="space-y-3">
      {/* 2D area: X=hue, Y=chroma */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] text-neutral-fg-subtle">Hue × Saturation</span>
          <span className="text-[11px] font-mono text-neutral-fg-subtle tabular-nums">
            {Math.round(hue)}° / {chroma.toFixed(3)}
          </span>
        </div>
        <div
          ref={containerRef as React.RefObject<HTMLDivElement>}
          className="relative cursor-crosshair rounded-md overflow-hidden border border-neutral-border-subtle"
          style={{ width: AREA_W, height: AREA_H }}
          onPointerDown={startDrag}
          onPointerMove={(e) => {
            if (e.buttons > 0) handlePointer(e);
          }}
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
            style={{ left: `${handleX}%`, top: `${handleY}%`, transform: "translate(-50%, -50%)" }}
          >
            <div className="w-3 h-3 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.3),0_1px_3px_rgba(0,0,0,0.4)]" />
          </div>
        </div>
      </div>

      {/* Presets */}
      <div className="flex gap-1">
        {PRESETS.map((preset) => {
          const active =
            Math.round(hue) === preset.hue && Math.abs(chroma - preset.chroma) < 0.0005;
          return (
            <button
              key={preset.label}
              type="button"
              onClick={() => handlePreset(preset)}
              className={`flex-1 py-1 rounded-md text-[11px] font-medium border transition-colors ${
                active
                  ? "bg-neutral-fg text-neutral-bg border-neutral-fg"
                  : "bg-transparent text-neutral-fg-subtle border-neutral-border hover:border-neutral-ring"
              }`}
            >
              {preset.label}
            </button>
          );
        })}
      </div>

      {/* Tonal preview strip — sorted light→dark or dark→light for a clean gradient */}
      <div className="flex gap-px rounded-md overflow-hidden border border-neutral-border-subtle">
        {[...previewLevels]
          .sort((a, b) => (isDark ? a - b : b - a))
          .map((lightness) => (
            <div
              key={lightness}
              className="h-5 flex-1 transition-colors duration-150"
              style={{ background: formatOklch(lightness, chroma, hue) }}
            />
          ))}
      </div>
    </div>
  );
}
