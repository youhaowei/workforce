import { describe, it, expect } from "vitest";
import { PALETTE, colorFromName } from "./palette";

describe("PALETTE", () => {
  it("contains 12 hex color strings", () => {
    expect(PALETTE).toHaveLength(12);
    for (const color of PALETTE) {
      expect(color).toMatch(/^#[A-Fa-f0-9]{6}$/);
    }
  });
});

describe("colorFromName", () => {
  it("returns a color from the palette", () => {
    const color = colorFromName("My Project");
    expect(PALETTE).toContain(color);
  });

  it("is deterministic — same name always returns same color", () => {
    const a = colorFromName("Workforce");
    const b = colorFromName("Workforce");
    expect(a).toBe(b);
  });

  it("returns different colors for different names", () => {
    const colors = new Set(["Alpha", "Beta", "Gamma", "Delta", "Epsilon"].map(colorFromName));
    // With 5 distinct names and 12 palette entries, expect at least 2 distinct colors
    expect(colors.size).toBeGreaterThanOrEqual(2);
  });

  it("handles empty string without throwing", () => {
    const color = colorFromName("");
    expect(PALETTE).toContain(color);
  });

  it("handles single-character names", () => {
    const color = colorFromName("A");
    expect(PALETTE).toContain(color);
  });

  it("handles unicode characters", () => {
    const color = colorFromName("プロジェクト");
    expect(PALETTE).toContain(color);
  });
});
