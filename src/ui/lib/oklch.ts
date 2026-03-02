/**
 * Lightweight OKLch ↔ hex conversion utilities.
 *
 * Uses the CSS color parsing API when available (Chrome 111+),
 * falls back to manual sRGB↔OKLab math.
 */

// ── Parse / Format ───────────────────────────────────────────────────────────

export function parseOklch(str: string): { l: number; c: number; h: number; alpha?: number } {
  const m = str.match(
    /oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)/,
  );
  if (!m) throw new Error(`Invalid oklch string: ${str}`);
  let alpha: number | undefined;
  if (m[4]) {
    alpha = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  }
  return { l: parseFloat(m[1]), c: parseFloat(m[2]), h: parseFloat(m[3]), alpha };
}

export function formatOklch(l: number, c: number, h: number, alpha?: number) {
  const lStr = round(l, 4);
  const cStr = round(c, 4);
  const hStr = round(h, 2);
  if (alpha != null && alpha < 1) return `oklch(${lStr} ${cStr} ${hStr} / ${round(alpha, 2)})`;
  return `oklch(${lStr} ${cStr} ${hStr})`;
}

// ── OKLch → Hex ──────────────────────────────────────────────────────────────

export function oklchToHex(l: number, c: number, h: number) {
  const hRad = (h * Math.PI) / 180;
  const a = c * Math.cos(hRad);
  const b = c * Math.sin(hRad);
  const [r, g, bl] = oklabToSrgb(l, a, b);
  return rgbToHex(clamp01(r), clamp01(g), clamp01(bl));
}

// ── Hex → OKLch ──────────────────────────────────────────────────────────────

export function hexToOklch(hex: string) {
  const [r, g, b] = hexToRgb(hex);
  const [L, a, bVal] = srgbToOklab(r / 255, g / 255, b / 255);
  const c = Math.sqrt(a * a + bVal * bVal);
  let h = (Math.atan2(bVal, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l: L, c, h };
}

// ── Internal: OKLab ↔ linear sRGB ────────────────────────────────────────────

function oklabToSrgb(L: number, a: number, b: number): [number, number, number] {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  const r = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;

  return [linearToSrgb(r), linearToSrgb(g), linearToSrgb(bl)];
}

function srgbToOklab(r: number, g: number, b: number): [number, number, number] {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);

  const l_ = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m_ = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s_ = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);

  return [
    0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
  ];
}

// ── Internal: gamma transfer ─────────────────────────────────────────────────

function srgbToLinear(c: number) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearToSrgb(c: number) {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

// ── Internal: hex ↔ rgb ──────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
}

function rgbToHex(r: number, g: number, b: number) {
  const toHex = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

function round(v: number, decimals: number) {
  const f = Math.pow(10, decimals);
  return Math.round(v * f) / f;
}
